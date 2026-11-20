import crypto from 'node:crypto';
import type { AutomationWorkflow, UserProfile, WorkflowRun } from '../shared/schema.ts';
import { db } from './db.ts';
import { runGroundedResearch } from './gemini.ts';
import { modelGateway } from './gateway.ts';

export async function runAutomationWorkflow(params: {
  workflow: AutomationWorkflow;
  triggerSource: 'manual' | 'schedule';
  profile: UserProfile;
  bypassApproval?: boolean;
  existingRunId?: string;
}): Promise<WorkflowRun> {
  const { workflow, triggerSource, profile } = params;
  const now = new Date().toISOString();
  const runId = params.existingRunId ?? `run-${crypto.randomUUID()}`;

  const logs: string[] = [
    `[${now}] Triggered via ${triggerSource} for "${workflow.name}".`,
  ];

  // Conditional keyword evaluation
  if (workflow.conditionKeyword?.trim()) {
    const keyword = workflow.conditionKeyword.trim().toLowerCase();
    const matched = workflow.actionPrompt.toLowerCase().includes(keyword);
    logs.push(
      `Condition check ("${workflow.conditionKeyword}"): ${matched ? 'MATCHED' : 'SKIPPED (keyword absent in payload)'}.`,
    );
    if (!matched) {
      const skippedRun: WorkflowRun = {
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: 'completed',
        triggerSource,
        stepLogs: logs,
        output: `Condition "${workflow.conditionKeyword}" was not met; action skipped cleanly.`,
        createdAt: now,
        completedAt: new Date().toISOString(),
      };
      db.markWorkflowLastRun(workflow.id, skippedRun.completedAt!);
      return db.saveWorkflowRun(skippedRun);
    }
  }

  // Approval gate for sensitive or external actions
  if (workflow.requiresApproval && !params.bypassApproval) {
    logs.push('Paused at security approval gate. Waiting for operator approval.');
    const pendingRun: WorkflowRun = {
      id: runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'awaiting_approval',
      triggerSource,
      stepLogs: logs,
      output: '',
      createdAt: now,
      completedAt: null,
    };
    return db.saveWorkflowRun(pendingRun);
  }

  if (params.bypassApproval) {
    logs.push(`[${new Date().toISOString()}] Operator approved execution.`);
  }

  try {
    let output = '';
    if (workflow.actionType === 'run_assistant') {
      const assistant = workflow.targetAssistantId
        ? db.getAssistant(workflow.targetAssistantId)
        : db.listAssistantsForUser(workflow.userId)[0] ?? null;
      if (!assistant) {
        throw new Error('Target assistant not found for workflow action.');
      }
      logs.push(`Dispatching task to specialist "${assistant.name}" (${assistant.model})...`);
      const res = await modelGateway.generate({
        userId: workflow.userId,
        model: assistant.model,
        taskType: 'orchestration',
        systemInstruction: `You are ${assistant.name}. Purpose: ${assistant.purpose}. Instructions: ${assistant.instructions}`,
        messages: [{ role: 'user', content: workflow.actionPrompt }],
        thinkingLevel: assistant.model === 'gemini-4-hydrogen' ? assistant.thinkingLevel : undefined,
        allowFallback: true,
        sourceEndpoint: '/api/automation/run',
      });
      output = res.text;
    } else if (workflow.actionType === 'run_research') {
      logs.push('Executing web-grounded research action...');
      const research = await runGroundedResearch({
        query: workflow.actionPrompt,
        mode: 'web_search',
      });
      output = research.reportMarkdown;
    } else {
      // Controlled notification / summary action (no unverified external webhook SSRF)
      logs.push('Preparing formatted notification digest (external HTTP dispatch disabled without configured target)...');
      const res = await modelGateway.generate({
        userId: workflow.userId,
        provider: profile.defaultProvider,
        model: profile.defaultModel,
        taskType: 'writing',
        messages: [
          {
            role: 'user',
            content: `Format the following operational alert concisely:\n${workflow.actionPrompt}`,
          },
        ],
        allowFallback: true,
        sourceEndpoint: '/api/automation/run',
      });
      output = res.text;
    }

    const completedAt = new Date().toISOString();
    logs.push(`[${completedAt}] Action completed successfully.`);
    db.markWorkflowLastRun(workflow.id, completedAt);
    return db.saveWorkflowRun({
      id: runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'completed',
      triggerSource,
      stepLogs: logs,
      output,
      createdAt: now,
      completedAt,
    });
  } catch (err) {
    const completedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : 'Workflow execution failed.';
    logs.push(`[${completedAt}] ERROR: ${message}`);
    db.markWorkflowLastRun(workflow.id, completedAt);
    return db.saveWorkflowRun({
      id: runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'failed',
      triggerSource,
      stepLogs: logs,
      output: message,
      createdAt: now,
      completedAt,
    });
  }
}

export function startAutomationScheduler(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    const workflows = db.listWorkflows();
    const nowMs = Date.now();
    for (const wf of workflows) {
      if (!wf.enabled || wf.triggerType !== 'schedule') continue;
      const intervalMs = Math.max(1, wf.scheduleIntervalMinutes ?? 60) * 60_000;
      const lastMs = wf.lastRunAt ? new Date(wf.lastRunAt).getTime() : 0;
      if (nowMs - lastMs < intervalMs) continue;

      const ownerProfile = db.getProfileForUser(wf.userId);
      if (!ownerProfile) continue;
      await runAutomationWorkflow({
        workflow: wf,
        triggerSource: 'schedule',
        profile: ownerProfile,
        bypassApproval: false,
      });
    }
  }, 30_000);
}
