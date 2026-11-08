import type { QueryResult } from "./types.js";

const validCitationConfidences = new Set(["extracted", "inferred", "ambiguous"]);

/**
 * The shape every memory agent prompt must ask for, kept next to the parser that
 * enforces it so a prompt cannot drift away from what the response is checked against.
 */
export const MEMORY_AGENT_JSON_CONTRACT = [
  "Reply with a single JSON object and nothing else - no prose, no code fences:",
  '{"answer": "<text citing pages as [rel_path §section]>", "citations": [{"relPath": "pages/example.md", "section": "optional heading", "confidence": "extracted | inferred | ambiguous"}], "tokensUsed": <integer>}'
].join("\n");

export function parseMemoryAgentResponse(
  stdout: string,
  context?: { stderr?: string }
): Pick<QueryResult, "answer" | "citations" | "tokensUsed"> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Memory agent returned invalid JSON output. ${describeAgentOutput(stdout, context?.stderr)}`
    );
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Memory agent returned an invalid result payload. ${describeAgentOutput(stdout, context?.stderr)}`
    );
  }

  const result = value as Record<string, unknown>;
  if (
    typeof result.answer !== "string" ||
    !Array.isArray(result.citations) ||
    !isNonNegativeInteger(result.tokensUsed) ||
    !result.citations.every(isQueryCitation)
  ) {
    throw new Error(
      `Memory agent returned an invalid result payload. ${describeAgentOutput(stdout, context?.stderr)}`
    );
  }

  return {
    answer: result.answer,
    citations: result.citations,
    tokensUsed: result.tokensUsed
  };
}

const MAX_REPORTED_OUTPUT_CHARS = 240;

function describeAgentOutput(stdout: string, stderr?: string): string {
  const parts = [`Received stdout: ${quoteOutput(stdout)}`];
  if ((stderr ?? "").trim().length > 0) {
    parts.push(`stderr: ${quoteOutput(stderr ?? "")}`);
  }
  return parts.join(" ");
}

function quoteOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "<empty>";
  }
  return JSON.stringify(
    trimmed.length > MAX_REPORTED_OUTPUT_CHARS
      ? `${trimmed.slice(0, MAX_REPORTED_OUTPUT_CHARS)}…`
      : trimmed
  );
}

function isQueryCitation(value: unknown): value is QueryResult["citations"][number] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const citation = value as Record<string, unknown>;
  return (
    typeof citation.relPath === "string" &&
    (citation.section === undefined || typeof citation.section === "string") &&
    typeof citation.confidence === "string" &&
    validCitationConfidences.has(citation.confidence)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
