import type { QueryResult } from "./types.js";

const validCitationConfidences = new Set(["extracted", "inferred", "ambiguous"]);

export function parseMemoryAgentResponse(
  stdout: string
): Pick<QueryResult, "answer" | "citations" | "tokensUsed"> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("Memory agent returned invalid JSON output.");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Memory agent returned an invalid result payload.");
  }

  const result = value as Record<string, unknown>;
  if (
    typeof result.answer !== "string" ||
    !Array.isArray(result.citations) ||
    !isNonNegativeInteger(result.tokensUsed) ||
    !result.citations.every(isQueryCitation)
  ) {
    throw new Error("Memory agent returned an invalid result payload.");
  }

  return {
    answer: result.answer,
    citations: result.citations,
    tokensUsed: result.tokensUsed
  };
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
