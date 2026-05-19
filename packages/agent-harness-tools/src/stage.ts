import { type RunAgentFn, type WorkflowMode } from "./hooks.js";
import {
  selectParticipantAgent,
  type WorkflowParticipant
} from "./participant.js";

export interface WorkflowStage {
  id: string;
  participant: string;
  prompt?: string;
  mode?: WorkflowMode;
  skills?: string[];
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
  const participant = participants[stage.participant];
  if (participant === undefined) {
    throw new Error(`Unknown participant: ${stage.participant}`);
  }

  return participant;
}

function resolveStageMode(
  stage: WorkflowStage,
  participant: WorkflowParticipant
): WorkflowMode {
  const mode = stage.mode ?? participant.mode;
  if (mode === undefined) {
    throw new Error(`Stage is missing mode for participant "${participant.id}".`);
  }

  return mode;
}

function resolveStagePrompt(
  stage: WorkflowStage,
  participant: WorkflowParticipant
): string {
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
  const mode = resolveStageMode(stage, participant);

  try {
    await context.runAgent({
      agent: selectParticipantAgent(participant, context.iteration),
      prompt: resolveStagePrompt(stage, participant),
      mode,
      cwd: context.cwd,
      ...(participant.model ? { model: participant.model } : {}),
      ...(stage.skills ? { skills: stage.skills } : {}),
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
