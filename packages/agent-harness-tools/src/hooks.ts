import {
  selectParticipantAgent,
  type WorkflowParticipant
} from "./participant.js";

export type WorkflowMode = "read" | "edit" | "yolo";

export interface WorkflowHook {
  participant?: string;
  mode?: WorkflowMode;
  prompt: string;
}

export interface RunAgentInput {
  agent: string;
  prompt: string;
  mode: WorkflowMode;
  cwd: string;
  model?: string;
  skills?: string[];
  signal?: AbortSignal;
}

export type RunAgentFn = (input: RunAgentInput) => Promise<unknown>;

export interface HookContext {
  cwd: string;
  participants: Record<string, WorkflowParticipant>;
  runAgent: RunAgentFn;
  signal?: AbortSignal;
}

function resolveDefaultParticipant(
  participants: Record<string, WorkflowParticipant>
): WorkflowParticipant {
  const defaultParticipant = participants.default;
  if (defaultParticipant !== undefined) {
    return defaultParticipant;
  }

  const participantIds = Object.keys(participants);
  if (participantIds.length === 1) {
    return participants[participantIds[0]];
  }

  throw new Error("Hook is missing a participant and no default participant is defined.");
}

function resolveHookParticipant(
  hook: WorkflowHook,
  participants: Record<string, WorkflowParticipant>
): WorkflowParticipant {
  if (hook.participant === undefined) {
    return resolveDefaultParticipant(participants);
  }

  const participant = participants[hook.participant];
  if (participant === undefined) {
    throw new Error(`Unknown participant: ${hook.participant}`);
  }

  return participant;
}

export async function runWorkflowHook(
  hook: WorkflowHook,
  context: HookContext
): Promise<void> {
  const participant = resolveHookParticipant(hook, context.participants);
  const mode = hook.mode ?? participant.mode;

  if (mode === undefined) {
    throw new Error(`Hook is missing mode for participant "${participant.id}".`);
  }

  await context.runAgent({
    agent: selectParticipantAgent(participant, 0),
    prompt: hook.prompt,
    mode,
    cwd: context.cwd,
    ...(participant.model ? { model: participant.model } : {}),
    ...(context.signal ? { signal: context.signal } : {})
  });
}
