import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  AI_MODELS,
  getProviderForModel,
} from '../shared/schema.ts';
import type {
  AIModelId,
  AIProviderId,
  GatewayAttemptTrace,
  GatewayMessage,
  GatewayRequest,
  GatewayResponse,
  GatewayTaskType,
  ProviderAvailabilityStatus,
  ProviderSetting,
  ThinkingLevelOption,
} from '../shared/schema.ts';
import { db as defaultDb, NexusDatabaseService } from './db.ts';

export interface AdapterGenerateInput {
  model: string;
  messages: GatewayMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  thinkingLevel?: ThinkingLevelOption;
  signal: AbortSignal;
}

export interface AdapterGenerateOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
}

export interface ModelProviderAdapter {
  readonly provider: AIProviderId;
  readonly label: string;
  readonly envVarName: string;
  readonly supportsWebGrounding: boolean;
  isConfigured(): boolean;
  generate(input: AdapterGenerateInput): Promise<AdapterGenerateOutput>;
}

export class GatewayProviderError extends Error {
  provider: AIProviderId;
  statusCode: number;
  retryable: boolean;
  unconfigured: boolean;

  constructor(params: {
    provider: AIProviderId;
    message: string;
    statusCode?: number;
    retryable?: boolean;
    unconfigured?: boolean;
  }) {
    super(params.message);
    this.name = 'GatewayProviderError';
    this.provider = params.provider;
    this.statusCode = params.statusCode ?? 502;
    this.retryable = params.retryable ?? false;
    this.unconfigured = params.unconfigured ?? false;
  }
}

function estimateTokenCount(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 4));
}

function isRetryableStatus(status: number, msg: string): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504 || status === 408) {
    return true;
  }
  const lower = msg.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('unavailable') ||
    lower.includes('resource_exhausted')
  );
}

function mapThinkingLevel(level?: ThinkingLevelOption): ThinkingLevel {
  if (level === 'LOW') return ThinkingLevel.LOW;
  if (level === 'HIGH') return ThinkingLevel.HIGH;
  return ThinkingLevel.MEDIUM;
}

function normalizeGeminiStatusAndMessage(err: unknown): {
  statusCode: number;
  message: string;
  retryable: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('api_key_invalid') || lower.includes('401') || lower.includes('403') || lower.includes('permission_denied')) {
    return {
      statusCode: 403,
      message: 'Google Gemini API key was rejected. Verify GEMINI_API_KEY in server secrets.',
      retryable: false,
    };
  }
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      statusCode: 429,
      message: 'Google Gemini rate limit or quota reached. Retry shortly or allow fallback.',
      retryable: true,
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      statusCode: 404,
      message: 'Requested Gemini model is unavailable.',
      retryable: false,
    };
  }
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('503') || lower.includes('unavailable')) {
    return {
      statusCode: 504,
      message: raw || 'Google Gemini request timed out or was temporarily unavailable.',
      retryable: true,
    };
  }
  return {
    statusCode: 502,
    message: raw || 'Google Gemini upstream error.',
    retryable: isRetryableStatus(502, raw),
  };
}

export class GoogleGeminiAdapter implements ModelProviderAdapter {
  readonly provider: AIProviderId = 'google';
  readonly label = 'Google Gemini';
  readonly envVarName = 'GEMINI_API_KEY';
  readonly supportsWebGrounding = true;

  isConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim() && key !== 'MY_GEMINI_API_KEY');
  }

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new GatewayProviderError({
        provider: 'google',
        message: 'Google Gemini API key is not configured on the server (GEMINI_API_KEY).',
        statusCode: 503,
        retryable: false,
        unconfigured: true,
      });
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateOutput> {
    const ai = this.getClient();
    const contents = input.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const config: Record<string, unknown> = {};
    if (input.systemInstruction) {
      config.systemInstruction = input.systemInstruction;
    }
    if (typeof input.temperature === 'number') {
      config.temperature = input.temperature;
    }
    if (typeof input.maxTokens === 'number') {
      config.maxOutputTokens = input.maxTokens;
    }
    if (input.responseFormat === 'json') {
      config.responseMimeType = 'application/json';
    }
    if (input.model === 'gemini-4-hydrogen' && input.thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: mapThinkingLevel(input.thinkingLevel),
      };
    }

    try {
      const response = await ai.models.generateContent({
        model: input.model,
        contents,
        config,
      });

      const text = (response.text ?? '').trim();
      const usage = (
        response as unknown as {
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
        }
      ).usageMetadata;

      const inputTokens =
        usage?.promptTokenCount ??
        estimateTokenCount(
          `${input.systemInstruction ?? ''}\n${input.messages.map((m) => m.content).join('\n')}`,
        );
      const outputTokens = usage?.candidatesTokenCount ?? estimateTokenCount(text);

      return {
        text,
        inputTokens,
        outputTokens,
        finishReason:
          response.candidates?.[0]?.finishReason ? String(response.candidates[0].finishReason) : 'STOP',
      };
    } catch (err) {
      if (err instanceof GatewayProviderError) throw err;
      const mapped = normalizeGeminiStatusAndMessage(err);
      throw new GatewayProviderError({
        provider: 'google',
        message: mapped.message,
        statusCode: mapped.statusCode,
        retryable: mapped.retryable,
      });
    }
  }
}

export class AnthropicClaudeAdapter implements ModelProviderAdapter {
  readonly provider: AIProviderId = 'anthropic';
  readonly label = 'Anthropic Claude';
  readonly envVarName = 'ANTHROPIC_API_KEY';
  readonly supportsWebGrounding = false;

  isConfigured(): boolean {
    const key = process.env.ANTHROPIC_API_KEY;
    return Boolean(key && key.trim() && key !== 'MY_ANTHROPIC_API_KEY');
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'MY_ANTHROPIC_API_KEY') {
      throw new GatewayProviderError({
        provider: 'anthropic',
        message:
          'Anthropic Claude API key is not configured on the server (ANTHROPIC_API_KEY). Add it to server environment secrets to enable Claude.',
        statusCode: 503,
        retryable: false,
        unconfigured: true,
      });
    }

    const systemParts = [input.systemInstruction].filter(Boolean) as string[];
    if (input.responseFormat === 'json') {
      systemParts.push('Return ONLY valid JSON without markdown code fences or prose outside the JSON object.');
    }

    const body = {
      model: input.model,
      max_tokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? 0.3,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: input.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Anthropic network failure';
      throw new GatewayProviderError({
        provider: 'anthropic',
        message: `Anthropic Claude connection error: ${msg}`,
        statusCode: 504,
        retryable: true,
      });
    }

    const payload = (await res.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
      error?: { message?: string; type?: string };
    };

    if (!res.ok) {
      const msg = payload.error?.message ?? `Anthropic API returned HTTP ${res.status}`;
      throw new GatewayProviderError({
        provider: 'anthropic',
        message: msg,
        statusCode: res.status,
        retryable: isRetryableStatus(res.status, msg),
      });
    }

    const text = (payload.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n')
      .trim();

    return {
      text,
      inputTokens:
        payload.usage?.input_tokens ??
        estimateTokenCount(input.messages.map((m) => m.content).join('\n')),
      outputTokens: payload.usage?.output_tokens ?? estimateTokenCount(text),
      finishReason: payload.stop_reason ?? 'end_turn',
    };
  }
}

export class OpenAIAdapter implements ModelProviderAdapter {
  readonly provider: AIProviderId = 'openai';
  readonly label = 'OpenAI';
  readonly envVarName = 'OPENAI_API_KEY';
  readonly supportsWebGrounding = false;

  isConfigured(): boolean {
    const key = process.env.OPENAI_API_KEY;
    return Boolean(key && key.trim() && key !== 'MY_OPENAI_API_KEY');
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateOutput> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') {
      throw new GatewayProviderError({
        provider: 'openai',
        message:
          'OpenAI API key is not configured on the server (OPENAI_API_KEY). Add it to server environment secrets to enable OpenAI models.',
        statusCode: 503,
        retryable: false,
        unconfigured: true,
      });
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (input.systemInstruction) {
      messages.push({ role: 'system', content: input.systemInstruction });
    }
    for (const msg of input.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const isReasoningModel = input.model.startsWith('o1') || input.model.startsWith('o3');
    const body: Record<string, unknown> = {
      model: input.model,
      messages,
    };

    if (!isReasoningModel && typeof input.temperature === 'number') {
      body.temperature = input.temperature;
    }
    if (typeof input.maxTokens === 'number') {
      if (isReasoningModel) {
        body.max_completion_tokens = input.maxTokens;
      } else {
        body.max_tokens = input.maxTokens;
      }
    }
    if (input.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: input.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OpenAI network failure';
      throw new GatewayProviderError({
        provider: 'openai',
        message: `OpenAI connection error: ${msg}`,
        statusCode: 504,
        retryable: true,
      });
    }

    const payload = (await res.json().catch(() => ({}))) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = payload.error?.message ?? `OpenAI API returned HTTP ${res.status}`;
      throw new GatewayProviderError({
        provider: 'openai',
        message: msg,
        statusCode: res.status,
        retryable: isRetryableStatus(res.status, msg),
      });
    }

    const text = (payload.choices?.[0]?.message?.content ?? '').trim();
    return {
      text,
      inputTokens:
        payload.usage?.prompt_tokens ??
        estimateTokenCount(input.messages.map((m) => m.content).join('\n')),
      outputTokens: payload.usage?.completion_tokens ?? estimateTokenCount(text),
      finishReason: payload.choices?.[0]?.finish_reason ?? 'stop',
    };
  }
}

export interface RoutingCandidate {
  provider: AIProviderId;
  model: string;
  setting: ProviderSetting;
}

export class ModelGatewayService {
  private adapters: Record<AIProviderId, ModelProviderAdapter>;
  private dbService: NexusDatabaseService;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(options?: {
    adapters?: Partial<Record<AIProviderId, ModelProviderAdapter>>;
    dbService?: NexusDatabaseService;
    sleepFn?: (ms: number) => Promise<void>;
  }) {
    this.adapters = {
      google: options?.adapters?.google ?? new GoogleGeminiAdapter(),
      anthropic: options?.adapters?.anthropic ?? new AnthropicClaudeAdapter(),
      openai: options?.adapters?.openai ?? new OpenAIAdapter(),
    };
    this.dbService = options?.dbService ?? defaultDb;
    this.sleepFn =
      options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  getAdapter(provider: AIProviderId): ModelProviderAdapter {
    return this.adapters[provider];
  }

  getProviderStatuses(userId: string): ProviderAvailabilityStatus[] {
    const settings = this.dbService.listProviderSettingsForUser(userId);
    return settings.map((s) => {
      const adapter = this.adapters[s.provider];
      return {
        ...s,
        label: adapter.label,
        configured: adapter.isConfigured(),
        envVarName: adapter.envVarName,
        supportsWebGrounding: adapter.supportsWebGrounding,
        models: AI_MODELS.filter((m) => m.providerId === s.provider),
      };
    });
  }

  resolveRoutingCandidates(
    userId: string,
    req: Pick<GatewayRequest, 'provider' | 'model' | 'taskType' | 'allowFallback'>,
  ): RoutingCandidate[] {
    const settings = this.dbService.listProviderSettingsForUser(userId);
    const byProvider = new Map<AIProviderId, ProviderSetting>(settings.map((s) => [s.provider, s]));

    const user = this.dbService.getUserById(userId);
    const explicitModel = req.model && req.model !== 'auto' ? req.model : undefined;
    const requestedProvider: AIProviderId | 'auto' = explicitModel
      ? getProviderForModel(explicitModel)
      : req.provider && req.provider !== 'auto'
        ? req.provider
        : user?.defaultProvider && user.defaultProvider !== 'auto'
          ? user.defaultProvider
          : 'auto';

    // Explicit provider selection: enforce honest failure if unconfigured & fallback disallowed
    if (requestedProvider !== 'auto') {
      const primarySetting = byProvider.get(requestedProvider);
      const primaryAdapter = this.adapters[requestedProvider];
      if (!primarySetting || !primarySetting.enabled) {
        if (req.allowFallback === false) {
          throw new GatewayProviderError({
            provider: requestedProvider,
            message: `Provider "${primaryAdapter.label}" is disabled in your Model Gateway settings.`,
            statusCode: 400,
            retryable: false,
          });
        }
      } else if (!primaryAdapter.isConfigured() && req.allowFallback === false) {
        throw new GatewayProviderError({
          provider: requestedProvider,
          message: `${primaryAdapter.label} is not configured on the server (${primaryAdapter.envVarName}).`,
          statusCode: 503,
          retryable: false,
          unconfigured: true,
        });
      }

      const candidates: RoutingCandidate[] = [];
      if (primarySetting?.enabled && primaryAdapter.isConfigured()) {
        candidates.push({
          provider: requestedProvider,
          model: explicitModel ?? primarySetting.defaultModel,
          setting: primarySetting,
        });
      } else if (primarySetting?.enabled && !primaryAdapter.isConfigured() && req.allowFallback === false) {
        throw new GatewayProviderError({
          provider: requestedProvider,
          message: `${primaryAdapter.label} requires ${primaryAdapter.envVarName}.`,
          statusCode: 503,
          unconfigured: true,
        });
      }

      if (req.allowFallback !== false) {
        const fallbacks = settings
          .filter(
            (s) =>
              s.provider !== requestedProvider &&
              s.enabled &&
              s.fallbackEnabled &&
              this.adapters[s.provider].isConfigured(),
          )
          .sort((a, b) => a.priority - b.priority);
        for (const fb of fallbacks) {
          candidates.push({
            provider: fb.provider,
            model: fb.defaultModel,
            setting: fb,
          });
        }
      }

      if (candidates.length === 0) {
        throw new GatewayProviderError({
          provider: requestedProvider,
          message: `${primaryAdapter.label} is unavailable (${primaryAdapter.envVarName} not configured) and no fallback provider is configured.`,
          statusCode: 503,
          retryable: false,
          unconfigured: !primaryAdapter.isConfigured(),
        });
      }
      return candidates;
    }

    // Auto-routing: pick enabled & configured providers ordered by priority (or task heuristic)
    const available = settings
      .filter((s) => s.enabled && this.adapters[s.provider].isConfigured())
      .sort((a, b) => a.priority - b.priority);

    if (available.length === 0) {
      throw new GatewayProviderError({
        provider: 'google',
        message:
          'No AI provider API key is configured and enabled on the server. Configure GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
        statusCode: 503,
        retryable: false,
        unconfigured: true,
      });
    }

    const candidates: RoutingCandidate[] = available.map((setting, idx) => {
      let model: string = setting.defaultModel;
      // Intelligent fast/reasoning optimization for auto mode
      if (idx === 0 && req.taskType === 'chat_qa' && setting.provider === 'google' && !explicitModel) {
        model = setting.defaultModel;
      } else if (idx === 0 && req.taskType === 'coding' && setting.provider === 'openai' && !explicitModel) {
        model = 'gpt-4o';
      }
      return {
        provider: setting.provider,
        model,
        setting,
      };
    });

    if (req.allowFallback === false) {
      return candidates.slice(0, 1);
    }

    const primary = candidates[0];
    const fallbacks = candidates
      .slice(1)
      .filter((c) => c.setting.fallbackEnabled);
    return [primary, ...fallbacks];
  }

  private async executeCandidateWithTimeoutAndRetries(
    candidate: RoutingCandidate,
    req: GatewayRequest,
  ): Promise<AdapterGenerateOutput> {
    const adapter = this.adapters[candidate.provider];
    const maxRetries = Math.min(3, Math.max(0, candidate.setting.maxRetries));
    const timeoutMs = req.timeoutMs ?? candidate.setting.timeoutMs ?? 25000;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new GatewayProviderError({
                provider: candidate.provider,
                message: `${adapter.label} (${candidate.model}) timed out after ${timeoutMs}ms`,
                statusCode: 504,
                retryable: true,
              }),
            );
          }, timeoutMs);
        });

        const output = await Promise.race([
          adapter.generate({
            model: candidate.model,
            messages: req.messages,
            systemInstruction: req.systemInstruction,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            responseFormat: req.responseFormat,
            thinkingLevel: req.thinkingLevel,
            signal: controller.signal,
          }),
          timeoutPromise,
        ]);

        if (!output.text || !output.text.trim()) {
          throw new GatewayProviderError({
            provider: candidate.provider,
            message: `${adapter.label} returned an empty response.`,
            statusCode: 502,
            retryable: true,
          });
        }
        return output;
      } catch (err) {
        lastError = err;
        const gwErr =
          err instanceof GatewayProviderError
            ? err
            : new GatewayProviderError({
                provider: candidate.provider,
                message: err instanceof Error ? err.message : String(err),
                statusCode: 502,
                retryable: isRetryableStatus(502, err instanceof Error ? err.message : String(err)),
              });

        if (!gwErr.retryable || attempt === maxRetries) {
          throw gwErr;
        }
        const backoffMs = 250 * 2 ** attempt;
        await this.sleepFn(backoffMs);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Gateway candidate failed.');
  }

  async generate(req: GatewayRequest): Promise<GatewayResponse> {
    const taskType: GatewayTaskType = req.taskType ?? 'chat_qa';
    const sourceEndpoint = req.sourceEndpoint ?? '/api/gateway';
    const candidates = this.resolveRoutingCandidates(req.userId, req);
    const traces: GatewayAttemptTrace[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const attemptStart = Date.now();
      try {
        const result = await this.executeCandidateWithTimeoutAndRetries(candidate, req);
        const latencyMs = Date.now() - attemptStart;
        const fallbackUsed = i > 0;
        traces.push({
          provider: candidate.provider,
          model: candidate.model,
          success: true,
          latencyMs,
        });

        const totalTokens = result.inputTokens + result.outputTokens;
        this.dbService.recordGatewayUsage({
          userId: req.userId,
          provider: candidate.provider,
          model: candidate.model,
          taskType,
          agentId: req.agentId ?? null,
          sourceEndpoint,
          status: fallbackUsed ? 'fallback_success' : 'success',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens,
          latencyMs,
          fallbackUsed,
          errorMessage: null,
        });

        return {
          id: `gw-${crypto.randomUUID()}`,
          provider: candidate.provider,
          model: candidate.model,
          text: result.text,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens,
          latencyMs,
          fallbackUsed,
          attemptedProviders: traces,
          finishReason: result.finishReason,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        const latencyMs = Date.now() - attemptStart;
        const message = err instanceof Error ? err.message : String(err);
        traces.push({
          provider: candidate.provider,
          model: candidate.model,
          success: false,
          latencyMs,
          error: message,
        });

        this.dbService.recordGatewayUsage({
          userId: req.userId,
          provider: candidate.provider,
          model: candidate.model,
          taskType,
          agentId: req.agentId ?? null,
          sourceEndpoint,
          status: 'error',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs,
          fallbackUsed: i > 0,
          errorMessage: message.slice(0, 500),
        });

        const hasNext = i < candidates.length - 1;
        if (!hasNext || req.allowFallback === false) {
          if (err instanceof GatewayProviderError) throw err;
          throw new GatewayProviderError({
            provider: candidate.provider,
            message,
            statusCode: 502,
          });
        }
      }
    }

    throw new GatewayProviderError({
      provider: 'google',
      message: 'All configured AI providers failed to respond.',
      statusCode: 502,
    });
  }
}

export const modelGateway = new ModelGatewayService();

export async function* streamGatewayChatReply(params: {
  userId: string;
  provider?: AIProviderId | 'auto';
  model: string;
  history: GatewayMessage[];
  userMessage: string;
  systemInstruction: string;
  thinkingLevel?: ThinkingLevelOption;
}): AsyncGenerator<{ delta?: string; modelUsed?: string; providerUsed?: AIProviderId }, void, unknown> {
  const requestedProvider: AIProviderId | 'auto' =
    params.model && params.model !== 'auto'
      ? getProviderForModel(params.model)
      : params.provider ?? 'auto';

  const candidates = modelGateway.resolveRoutingCandidates(params.userId, {
    provider: requestedProvider,
    model: params.model,
    taskType: 'chat_qa',
    allowFallback: true,
  });

  const primary = candidates[0];

  // Use native streaming when primary is Google Gemini and configured
  if (primary.provider === 'google' && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
    const started = Date.now();
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const config: Record<string, unknown> = {
        systemInstruction: params.systemInstruction,
      };
      if (primary.model === 'gemini-4-hydrogen' && params.thinkingLevel) {
        config.thinkingConfig = { thinkingLevel: mapThinkingLevel(params.thinkingLevel) };
      }

      const chat = ai.chats.create({
        model: primary.model,
        history: params.history.map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }],
        })),
        config,
      });

      const stream = await chat.sendMessageStream({ message: params.userMessage });
      let fullText = '';
      for await (const chunk of stream) {
        const text = (chunk as { text?: string }).text;
        if (text) {
          fullText += text;
          yield { delta: text, modelUsed: primary.model, providerUsed: 'google' };
        }
      }

      const inputTokens = estimateTokenCount(
        `${params.systemInstruction}\n${params.history.map((m) => m.content).join('\n')}\n${params.userMessage}`,
      );
      const outputTokens = estimateTokenCount(fullText);
      defaultDb.recordGatewayUsage({
        userId: params.userId,
        provider: 'google',
        model: primary.model,
        taskType: 'chat_qa',
        agentId: null,
        sourceEndpoint: '/api/conversations/:id/messages/stream',
        status: 'success',
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs: Date.now() - started,
        fallbackUsed: false,
        errorMessage: null,
      });
      return;
    } catch (streamErr) {
      defaultDb.recordGatewayUsage({
        userId: params.userId,
        provider: 'google',
        model: primary.model,
        taskType: 'chat_qa',
        agentId: null,
        sourceEndpoint: '/api/conversations/:id/messages/stream',
        status: 'error',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - started,
        fallbackUsed: false,
        errorMessage: streamErr instanceof Error ? streamErr.message : String(streamErr),
      });
      // Fall through to gateway fallback chain if fallback is configured
      if (candidates.length <= 1) {
        throw streamErr;
      }
    }
  }

  // Unified Gateway execution (supports Claude, OpenAI, or Gemini fallback)
  const response = await modelGateway.generate({
    userId: params.userId,
    provider: params.provider,
    model: params.model,
    taskType: 'chat_qa',
    systemInstruction: params.systemInstruction,
    messages: [...params.history, { role: 'user', content: params.userMessage }],
    thinkingLevel: params.thinkingLevel,
    allowFallback: true,
    sourceEndpoint: '/api/conversations/:id/messages/stream',
  });

  // Stream word chunks cleanly so SSE consumers receive smooth progressive updates
  const chunks = response.text.match(/.{1,48}(\s|$)/gs) ?? [response.text];
  for (const piece of chunks) {
    yield {
      delta: piece,
      modelUsed: response.model,
      providerUsed: response.provider,
    };
  }
}

export function getSupportedModelIds(): AIModelId[] {
  return AI_MODELS.map((m) => m.id);
}
