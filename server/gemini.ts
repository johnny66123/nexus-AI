import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Content, GenerateContentResponse } from '@google/genai';
import { compileSystemPrompt } from '../shared/schema.ts';
import type {
  Assistant,
  AssistantMemory,
  ChatMessage,
  KnowledgeSearchHit,
  OrchestrationRun,
  OrchestrationStep,
  ResearchCitation,
  ThinkingLevelOption,
  UserProfile,
} from '../shared/schema.ts';
import { wrapUntrustedContext } from './security.ts';
import { modelGateway } from './gateway.ts';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiConfigError(
      'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiConfigError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'GeminiConfigError';
    this.statusCode = statusCode;
  }
}

function mapThinkingLevel(level: ThinkingLevelOption): ThinkingLevel {
  if (level === 'LOW') return ThinkingLevel.LOW;
  if (level === 'HIGH') return ThinkingLevel.HIGH;
  return ThinkingLevel.MEDIUM;
}

function buildHistory(messages: ChatMessage[]): Content[] {
  return messages.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.content }],
  }));
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  if (err instanceof GeminiConfigError) {
    return { status: err.statusCode, message: err.message };
  }
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('403') ||
    lower.includes('401')
  ) {
    return {
      status: 403,
      message: 'The server Gemini API key was rejected. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'Rate limit or quota reached for this Gemini model. Wait briefly and retry.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      message: 'The requested Gemini model is unavailable.',
    };
  }
  if (lower.includes('400') || lower.includes('invalid_argument')) {
    return {
      status: 400,
      message: `Invalid request sent to Gemini API: ${rawMessage}`,
    };
  }
  return {
    status: 502,
    message: rawMessage || 'Failed to generate a response from the Gemini API.',
  };
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isTransient =
        msg.includes('503') ||
        msg.includes('unavailable') ||
        msg.includes('econnreset') ||
        msg.includes('timeout');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export async function* streamAssistantReply(params: {
  assistant: Assistant;
  history: ChatMessage[];
  userMessage: string;
  profile: UserProfile;
  approvedMemories?: AssistantMemory[];
  knowledgeHits?: KnowledgeSearchHit[];
}): AsyncGenerator<string, void, unknown> {
  const ai = getClient();
  const systemInstruction = compileSystemPrompt(
    params.assistant,
    params.profile.responseFormatPreference,
    params.approvedMemories,
  );

  const config: Record<string, unknown> = {
    systemInstruction,
  };

  if (params.assistant.model === 'gemini-4-hydrogen') {
    config.thinkingConfig = {
      thinkingLevel: mapThinkingLevel(params.assistant.thinkingLevel),
    };
  }

  let composedMessage = params.userMessage;
  if (params.knowledgeHits && params.knowledgeHits.length > 0) {
    const contextText = params.knowledgeHits
      .map(
        (h) =>
          `[Document: ${h.documentTitle} | Chunk #${h.chunkIndex + 1}]\n${h.content}`,
      )
      .join('\n\n');
    composedMessage = `${wrapUntrustedContext('knowledge_base', contextText)}\n\nUser Question: ${params.userMessage}`;
  }

  const chat = ai.chats.create({
    model: params.assistant.model,
    history: buildHistory(params.history),
    config,
  });

  const stream = await withRetry(() =>
    chat.sendMessageStream({
      message: composedMessage,
    }),
  );

  for await (const chunk of stream) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      yield c.text;
    }
  }
}

export async function generateText(params: {
  prompt: string;
  systemInstruction?: string;
  model?: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  thinkingLevel?: ThinkingLevelOption;
}): Promise<string> {
  const ai = getClient();
  const model = params.model ?? 'gemini-4-hydrogen';
  const config: Record<string, unknown> = {};
  if (params.systemInstruction) {
    config.systemInstruction = params.systemInstruction;
  }
  if (model === 'gemini-4-hydrogen' && params.thinkingLevel) {
    config.thinkingConfig = {
      thinkingLevel: mapThinkingLevel(params.thinkingLevel),
    };
  }

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: params.prompt,
      config,
    }),
  );

  return (response.text ?? '').trim();
}

export async function extractCandidateMemories(params: {
  assistantName: string;
  conversationText: string;
}): Promise<Array<{ key: string; content: string; category: 'preference' | 'fact' | 'rule' | 'context' }>> {
  const ai = getClient();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Extract up to 3 concise, durable long-term facts, user preferences, or workflow rules from this conversation for assistant "${params.assistantName}". Only extract clear, useful facts.\n\n${wrapUntrustedContext('conversation_transcript', params.conversationText)}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              key: { type: Type.STRING },
              content: { type: Type.STRING },
              category: { type: Type.STRING },
            },
          },
        },
      },
    }),
  );

  try {
    const parsed = JSON.parse(response.text ?? '[]') as Array<{
      key?: string;
      content?: string;
      category?: string;
    }>;
    const validCategories = new Set(['preference', 'fact', 'rule', 'context']);
    return parsed
      .filter((item) => item.key && item.content)
      .slice(0, 3)
      .map((item) => ({
        key: String(item.key).slice(0, 80),
        content: String(item.content).slice(0, 1000),
        category: validCategories.has(String(item.category))
          ? (item.category as 'preference' | 'fact' | 'rule' | 'context')
          : 'fact',
      }));
  } catch {
    return [];
  }
}

// Module 2: Multi-Agent Orchestration via NEXUS Master AI
export async function executeMultiAgentOrchestration(params: {
  runId: string;
  userId: string;
  objective: string;
  agents: Assistant[];
  sharedContext: string;
  memoriesByAgent: Map<string, AssistantMemory[]>;
  profile: UserProfile;
}): Promise<OrchestrationRun> {
  const ai = getClient();
  const createdAt = new Date().toISOString();

  const agentRoster = params.agents
    .map((a) => `- ID: ${a.id} | Name: ${a.name} | Purpose: ${a.purpose} | Description: ${a.description}`)
    .join('\n');

  // Step 1: Master AI creates structured execution plan
  const planResp = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `You are NEXUS Master AI, an orchestration coordinator. Decompose the user's objective into sequential specialist tasks, assigning one task to each available agent where appropriate (at least one step per selected agent).\n\nObjective: ${params.objective}\n\nAvailable Specialist Agents:\n${agentRoster}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              agentId: { type: Type.STRING },
              assignedTask: { type: Type.STRING },
            },
          },
        },
      },
    }),
  );

  let plannedAssignments: Array<{ agentId: string; assignedTask: string }> = [];
  try {
    plannedAssignments = JSON.parse(planResp.text ?? '[]');
  } catch {
    plannedAssignments = [];
  }

  // Fallback deterministic decomposition if JSON omits agents
  const agentMap = new Map(params.agents.map((a) => [a.id, a]));
  const validAssignments = plannedAssignments.filter((p) => agentMap.has(p.agentId) && p.assignedTask);
  if (validAssignments.length === 0) {
    validAssignments.push(
      ...params.agents.map((a) => ({
        agentId: a.id,
        assignedTask: `Contribute your ${a.purpose} expertise toward this objective: ${params.objective}`,
      })),
    );
  }

  const steps: OrchestrationStep[] = [];
  const priorOutputs: string[] = [];

  for (let i = 0; i < validAssignments.length; i++) {
    const item = validAssignments[i];
    const agent = agentMap.get(item.agentId) ?? params.agents[0];
    const startMs = Date.now();
    let attempts = 0;
    let output = '';
    let stepStatus: OrchestrationStep['status'] = 'completed';
    let stepError: string | undefined;

    const handoffContext = [
      params.sharedContext ? `Approved Shared Context:\n${wrapUntrustedContext('approved_shared_context', params.sharedContext)}` : '',
      priorOutputs.length > 0
        ? `Previous Specialist Handoffs:\n${wrapUntrustedContext('agent_handoffs', priorOutputs.join('\n\n---\n\n'))}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const promptForAgent = [
      `Overall Mission Objective: ${params.objective}`,
      `Your Assigned Task: ${item.assignedTask}`,
      handoffContext,
      'Provide a concise, high-signal deliverable for your assigned sub-task so NEXUS Master AI can synthesize the final solution.',
    ]
      .filter(Boolean)
      .join('\n\n');

    // Attempt specialist execution with failure recovery (retry + fallback to flash-lite if needed)
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      try {
        const modelToUse = attempt === 1 ? agent.model : 'gemini-3.1-flash-lite';
        const sysPrompt = compileSystemPrompt(
          agent,
          params.profile.responseFormatPreference,
          params.memoriesByAgent.get(agent.id),
        );
        output = (
          await modelGateway.generate({
            userId: params.userId,
            model: modelToUse,
            taskType: 'orchestration',
            systemInstruction: sysPrompt,
            messages: [{ role: 'user', content: promptForAgent }],
            thinkingLevel: modelToUse === 'gemini-4-hydrogen' ? agent.thinkingLevel : undefined,
            allowFallback: true,
            agentId: agent.id,
            sourceEndpoint: '/api/orchestration/run',
          })
        ).text;
        if (!output) throw new Error('Specialist returned empty output.');
        stepStatus = attempt > 1 ? 'recovered' : 'completed';
        stepError = undefined;
        break;
      } catch (err) {
        stepError = err instanceof Error ? err.message : 'Specialist execution failed';
        if (attempt === 2) {
          stepStatus = 'failed';
        }
      }
    }

    if (output) {
      priorOutputs.push(`[Specialist: ${agent.name} | Task: ${item.assignedTask}]\n${output}`);
    }

    steps.push({
      stepNumber: i + 1,
      agentId: agent.id,
      agentName: agent.name,
      assignedTask: item.assignedTask,
      status: stepStatus,
      output: output || `Task failed after ${attempts} attempt(s): ${stepError ?? 'Unknown error'}`,
      error: stepError,
      attempts,
      durationMs: Date.now() - startMs,
    });
  }

  // Step 3: Master AI synthesizes all outputs into one unified final response
  const completedCount = steps.filter((s) => s.status === 'completed' || s.status === 'recovered').length;
  let finalSynthesis = '';
  if (completedCount === 0) {
    finalSynthesis =
      'All specialist agent steps failed during execution. Review the step errors and verify your Model Gateway provider configuration.';
  } else {
    finalSynthesis = (
      await modelGateway.generate({
        userId: params.userId,
        provider: params.profile.defaultProvider,
        model: params.profile.defaultModel,
        taskType: 'orchestration',
        thinkingLevel: 'MEDIUM',
        systemInstruction:
          'You are NEXUS Master AI. Synthesize the contributions from multiple specialist agents into a single, cohesive, structured final response without contradictions.',
        messages: [
          {
            role: 'user',
            content: `Objective: ${params.objective}\n\nSpecialist Outputs:\n${priorOutputs.join('\n\n===\n\n')}`,
          },
        ],
        allowFallback: true,
        sourceEndpoint: '/api/orchestration/run',
      })
    ).text;
  }

  return {
    id: params.runId,
    userId: params.userId,
    objective: params.objective,
    agentIds: params.agents.map((a) => a.id),
    sharedContext: params.sharedContext,
    status: completedCount > 0 ? 'completed' : 'failed',
    steps,
    finalSynthesis,
    createdAt,
    completedAt: new Date().toISOString(),
  };
}

// Module 4: AI Research Centre (Google Search Grounding + Document Analysis)
export async function runGroundedResearch(params: {
  query: string;
  mode: 'web_search' | 'document_analysis' | 'combined';
  documentContext?: string;
}): Promise<{ summary: string; reportMarkdown: string; citations: ResearchCitation[] }> {
  const ai = getClient();

  const useWeb = params.mode === 'web_search' || params.mode === 'combined';
  const promptParts = [
    `Conduct a thorough, objective research analysis on the following topic:\n"${params.query}"`,
    params.documentContext
      ? `Incorporate and cite facts from these uploaded Knowledge Centre documents:\n${wrapUntrustedContext('knowledge_documents', params.documentContext)}`
      : '',
    'Format the response in clean Markdown with:\n1. Executive Summary (2-3 crisp sentences)\n2. Key Findings\n3. Analysis & Trade-offs\n4. Recommended Next Steps',
  ].filter(Boolean);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: promptParts.join('\n\n'),
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        ...(useWeb ? { tools: [{ googleSearch: {} }] } : {}),
      },
    }),
  );

  const reportMarkdown = (response.text ?? '').trim();
  const summaryLine =
    reportMarkdown
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) ?? 'Research report generated.';

  const citations: ResearchCitation[] = [];
  const seenUris = new Set<string>();
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (web?.uri && !seenUris.has(web.uri)) {
      seenUris.add(web.uri);
      citations.push({
        title: web.title || web.uri,
        uri: web.uri,
      });
    }
  }

  return {
    summary: summaryLine.slice(0, 260),
    reportMarkdown,
    citations,
  };
}

// Module 7: Speech Synthesis (TTS) & Audio Transcription
export async function synthesizeSpeechWav(params: {
  text: string;
  voiceName?: string;
  style?: string;
}): Promise<{ audioDataUrl: string; mimeType: string }> {
  const ai = getClient();
  const voiceName = params.voiceName || 'Kore';
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: params.text,
              speechMetadata: {
                style: params.style || 'Clear, natural, articulate studio voice',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    }),
  );

  const part = response.candidates?.[0]?.content?.parts?.[0];
  const base64Audio = part?.inlineData?.data;
  const mimeType = part?.inlineData?.mimeType ?? 'audio/wav';
  if (!base64Audio) {
    throw new Error('Speech synthesis did not return audio data.');
  }
  return {
    audioDataUrl: `data:${mimeType};base64,${base64Audio}`,
    mimeType,
  };
}

export async function transcribeAudioBase64(params: {
  base64Data: string;
  mimeType: string;
  prompt?: string;
}): Promise<string> {
  const ai = getClient();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Data,
            },
          },
          {
            text:
              params.prompt ||
              'Transcribe this audio accurately. Provide clean punctuated paragraphs.',
          },
        ],
      },
    }),
  );
  return (response.text ?? '').trim();
}

export async function analyzeImageBase64(params: {
  base64Data: string;
  mimeType: string;
  prompt: string;
}): Promise<string> {
  const ai = getClient();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Data,
            },
          },
          { text: params.prompt },
        ],
      },
    }),
  );
  return (response.text ?? '').trim();
}
