import { type RunAgentFn, type RunAgentHooks, type WorkflowMode } from "./hooks.js";
import { selectParticipantAgent, type WorkflowParticipant } from "./participant.js";

export interface WorkflowStage {
  id: string;
  participant: string;
  prompt?: string;
  mode?: WorkflowMode;
  skills?: string[];
  hooks?: RunAgentHooks;
  onFailure?: "stop" | "continue";
}

export interface StageContext {
  cwd: string;
  participants: Record<string, WorkflowParticipant>;
  runAgent: RunAgentFn;
  signal?: AbortSignal;
  iteration: number;
}

function resolveStageParticipant(
  stage: WorkflowStage,
  participants: Record<string, WorkflowParticipant>
): WorkflowParticipant {
  if (!Object.hasOwn(participants, stage.participant)) {
    throw new Error(`Unknown participant: ${stage.participant}`);
  }

  return participants[stage.participant]!;
}

function resolveStagePrompt(stage: WorkflowStage, participant: WorkflowParticipant): string {
  return stage.prompt ?? participant.prompt ?? "";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runWorkflowStage(
  stage: WorkflowStage,
  context: StageContext
): Promise<{ success: boolean; error?: Error }> {
  const participant = resolveStageParticipant(stage, context.participants);
  const mode = stage.mode ?? participant.mode;

  try {
    await context.runAgent({
      agent: selectParticipantAgent(participant, context.iteration),
      prompt: resolveStagePrompt(stage, participant),
      cwd: context.cwd,
      ...(mode !== undefined ? { mode } : {}),
      ...(participant.model ? { model: participant.model } : {}),
      ...(stage.skills ? { skills: stage.skills } : {}),
      ...(stage.hooks ? { hooks: stage.hooks } : {}),
      ...(context.signal ? { signal: context.signal } : {})
    });

    return { success: true };
  } catch (error) {
    const stageError = toError(error);
    if (stage.onFailure === "continue") {
      return { success: false, error: stageError };
    }

    throw stageError;
  }
}
