import { normalizeAgentId, parseAgentSpecifier } from "@poe-code/agent-defs";
import type { WorkflowMode } from "./hooks.js";

export interface WorkflowParticipant {
  id: string;
  agent: string | string[];
  mode?: WorkflowMode;
  model?: string;
  prompt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnEntry(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return hasOwnEntry(record, key) ? record[key] : undefined;
}

function invalidAgentError(id: string): Error {
  return new Error(`Participant "${id}" must define a non-empty agent.`);
}

function nonEmptyString(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}

function validateAgentSpecifier(id: string, value: string): void {
  try {
    parseAgentSpecifier(value);
  } catch {
    throw invalidAgentError(id);
  }
}

function normalizeParticipantAgent(id: string, value: unknown): string | string[] {
  if (typeof value === "string") {
    validateAgentSpecifier(id, value);
    const normalized = normalizeAgentId(value);
    if (normalized.length === 0) {
      throw invalidAgentError(id);
    }
    return normalized;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Participant "${id}" has invalid agent. Expected a string or string array.`);
  }

  if (value.length === 0) {
    throw new Error(`Participant "${id}" must define at least one agent.`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`Participant "${id}" has invalid agent. Expected a string or string array.`);
    }

    validateAgentSpecifier(id, entry);
    const normalized = normalizeAgentId(entry);
    if (normalized.length === 0) {
      throw invalidAgentError(id);
    }

    return normalized;
  });
}

export function normalizeParticipantConfig(id: string, value: unknown): WorkflowParticipant {
  const input: unknown = typeof value === "string" ? { agent: value } : value;

  if (!isRecord(input)) {
    throw new Error(`Participant "${id}" must be a string or object.`);
  }

  if (!hasOwnEntry(input, "agent")) {
    throw new Error(`Participant "${id}" is missing required field: agent.`);
  }

  const participant: WorkflowParticipant = {
    id,
    agent: normalizeParticipantAgent(id, getOwnEntry(input, "agent"))
  };

  const mode = getOwnEntry(input, "mode");
  if (mode !== undefined) {
    if (mode !== "read" && mode !== "edit" && mode !== "auto" && mode !== "yolo") {
      throw new Error(
        `Participant "${id}" has invalid mode. Expected "read", "edit", "auto", or "yolo".`
      );
    }
    participant.mode = mode;
  }

  const model = getOwnEntry(input, "model");
  if (model !== undefined) {
    if (typeof model !== "string") {
      throw new Error(`Participant "${id}" has invalid model. Expected a string.`);
    }
    participant.model = nonEmptyString(model, `Participant "${id}" must define a non-empty model.`);
  }

  const prompt = getOwnEntry(input, "prompt");
  if (prompt !== undefined) {
    if (typeof prompt !== "string") {
      throw new Error(`Participant "${id}" has invalid prompt. Expected a string.`);
    }
    participant.prompt = nonEmptyString(
      prompt,
      `Participant "${id}" must define a non-empty prompt.`
    );
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
