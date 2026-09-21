import { selectParticipantAgent, type WorkflowParticipant } from "./participant.js";

export type WorkflowMode = "read" | "edit" | "auto" | "yolo";

export interface RunAgentHooks {
  from: string;
  strategy?: "auto" | "symlink" | "transform";
  scope?: "project" | "user" | "merged";
}

export interface WorkflowHook {
  participant?: string;
  mode?: WorkflowMode;
  prompt: string;
}

export interface RunAgentInput {
  agent: string;
  prompt: string;
  mode?: WorkflowMode;
  cwd: string;
  model?: string;
  skills?: string[];
  hooks?: RunAgentHooks;
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

  if (!Object.hasOwn(participants, hook.participant)) {
    throw new Error(`Unknown participant: ${hook.participant}`);
  }

  return participants[hook.participant]!;
}

export async function runWorkflowHook(hook: WorkflowHook, context: HookContext): Promise<void> {
  const participant = resolveHookParticipant(hook, context.participants);
  const mode = hook.mode ?? participant.mode;

  await context.runAgent({
    agent: selectParticipantAgent(participant, 0),
    prompt: hook.prompt,
    cwd: context.cwd,
    ...(mode !== undefined ? { mode } : {}),
    ...(participant.model ? { model: participant.model } : {}),
    ...(context.signal ? { signal: context.signal } : {})
  });
}
