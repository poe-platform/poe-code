import { normalizeAgentId } from "@poe-code/agent-defs";

export interface WorkflowParticipant {
  id: string;
  agent: string | string[];
  mode?: "read" | "edit" | "yolo";
  model?: string;
  prompt?: string;
}

type WorkflowParticipantInput = Omit<WorkflowParticipant, "id">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeParticipantAgent(id: string, value: unknown): string | string[] {
  if (typeof value === "string") {
    const normalized = normalizeAgentId(value);
    if (normalized.length === 0) {
      throw new Error(`Participant "${id}" must define a non-empty agent.`);
    }
    return normalized;
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `Participant "${id}" has invalid agent. Expected a string or string array.`
    );
  }

  if (value.length === 0) {
    throw new Error(`Participant "${id}" must define at least one agent.`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(
        `Participant "${id}" has invalid agent. Expected a string or string array.`
      );
    }

    const normalized = normalizeAgentId(entry);
    if (normalized.length === 0) {
      throw new Error(`Participant "${id}" must define a non-empty agent.`);
    }

    return normalized;
  });
}

export function normalizeParticipantConfig(
  id: string,
  value: unknown
): WorkflowParticipant {
  const input: unknown = typeof value === "string" ? { agent: value } : value;

  if (!isRecord(input)) {
    throw new Error(`Participant "${id}" must be a string or object.`);
  }

  if (!("agent" in input)) {
    throw new Error(`Participant "${id}" is missing required field: agent.`);
  }

  const participantInput = input as WorkflowParticipantInput & Record<string, unknown>;
  const participant: WorkflowParticipant = {
    id,
    agent: normalizeParticipantAgent(id, participantInput.agent)
  };

  if (participantInput.mode !== undefined) {
    if (
      participantInput.mode !== "read" &&
      participantInput.mode !== "edit" &&
      participantInput.mode !== "yolo"
    ) {
      throw new Error(
        `Participant "${id}" has invalid mode. Expected "read", "edit", or "yolo".`
      );
    }
    participant.mode = participantInput.mode;
  }

  if (participantInput.model !== undefined) {
    if (typeof participantInput.model !== "string") {
      throw new Error(`Participant "${id}" has invalid model. Expected a string.`);
    }
    participant.model = participantInput.model;
  }

  if (participantInput.prompt !== undefined) {
    if (typeof participantInput.prompt !== "string") {
      throw new Error(`Participant "${id}" has invalid prompt. Expected a string.`);
    }
    participant.prompt = participantInput.prompt;
  }

  return participant;
}

export function selectParticipantAgent(
  participant: WorkflowParticipant,
  iteration: number
): string {
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new Error("Participant iteration must be a non-negative integer.");
  }

  if (typeof participant.agent === "string") {
    return participant.agent;
  }

  return participant.agent[iteration % participant.agent.length];
}
