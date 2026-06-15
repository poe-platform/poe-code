import { defineCommand, type Scope, UserError } from "toolcraft";
import { S, toJsonSchema } from "toolcraft-schema";

import { resolveCommandEntries, type CommandEntry, type CommandEntryList } from "./tree.js";

export type SearchDetail = "brief" | "detailed" | "full";

export type SearchDefaults = {
  detail?: SearchDetail;
  limit?: number;
};

export type SearchCommandOptions = {
  entries: CommandEntryList;
  defaults?: SearchDefaults;
  scope?: Scope[];
};

export type SearchResult = {
  path: string;
  description: string;
  schema?: object;
};

type IndexedEntry = {
  entry: CommandEntry;
  frequencies: Map<string, number>;
  length: number;
};

const K1 = 1.5;
const B = 0.75;
const FALLBACK_LIMIT = 10;
const SEARCH_DETAILS = ["brief", "detailed", "full"] as const;

const searchParams = S.Object({
  query: S.String({ description: "Search query." }),
  limit: S.Optional(
    S.Number({
      description: "Maximum result count.",
      jsonType: "integer",
      minimum: 0
    })
  ),
  detail: S.Optional(
    S.Enum(SEARCH_DETAILS, {
      description: "Result detail level."
    })
  )
});

function isWordCharacter(character: string): boolean {
  const code = character.charCodeAt(0);

  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || character === "_";
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  let current = "";

  for (const character of value) {
    const lowerCharacter = character.toLowerCase();

    if (lowerCharacter.length === 1 && isWordCharacter(lowerCharacter)) {
      current += lowerCharacter;
      continue;
    }

    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function indexEntry(entry: CommandEntry): IndexedEntry {
  const source = `${entry.name} ${entry.command.description ?? ""} ${entry.path}`;
  const tokens = tokenize(source);
  const frequencies = new Map<string, number>();

  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  return {
    entry,
    frequencies,
    length: tokens.length
  };
}

function documentFrequencies(indexedEntries: IndexedEntry[]): Map<string, number> {
  const frequencies = new Map<string, number>();

  for (const indexedEntry of indexedEntries) {
    for (const token of indexedEntry.frequencies.keys()) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }

  return frequencies;
}

function averageDocumentLength(indexedEntries: IndexedEntry[]): number {
  if (indexedEntries.length === 0) {
    return 0;
  }

  let totalLength = 0;

  for (const indexedEntry of indexedEntries) {
    totalLength += indexedEntry.length;
  }

  return totalLength / indexedEntries.length;
}

function bm25Score(
  indexedEntry: IndexedEntry,
  queryTokens: string[],
  frequencies: Map<string, number>,
  documentCount: number,
  averageLength: number
): number {
  let score = 0;

  for (const token of queryTokens) {
    const termFrequency = indexedEntry.frequencies.get(token) ?? 0;

    if (termFrequency === 0) {
      continue;
    }

    const documentFrequency = frequencies.get(token) ?? 0;
    const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const lengthRatio = averageLength === 0 ? 0 : indexedEntry.length / averageLength;
    const denominator = termFrequency + K1 * (1 - B + B * lengthRatio);

    score += idf * ((termFrequency * (K1 + 1)) / denominator);
  }

  return score;
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new UserError(`limit must be a non-negative integer, received ${limit}`);
  }

  return limit;
}

function normalizeDetail(detail: unknown): SearchDetail {
  if (SEARCH_DETAILS.includes(detail as SearchDetail)) {
    return detail as SearchDetail;
  }

  throw new UserError(
    `detail must be one of: ${SEARCH_DETAILS.join(", ")}, received ${JSON.stringify(detail)}`
  );
}

function toSearchResult(entry: CommandEntry, detail: SearchDetail): SearchResult {
  const result: SearchResult = {
    path: entry.path,
    description: entry.command.description ?? ""
  };

  if (detail === "detailed" || detail === "full") {
    result.schema = toJsonSchema(entry.command.params as Parameters<typeof toJsonSchema>[0]);
  }

  return result;
}

export function makeSearchCommand({
  entries,
  defaults = {},
  scope = ["mcp", "sdk"]
}: SearchCommandOptions) {
  return defineCommand({
    name: "search",
    description: "Search available commands.",
    scope,
    params: searchParams,
    handler: async ({ params }): Promise<SearchResult[]> => {
      const resolvedEntries = await resolveCommandEntries(entries);
      const queryTokens = tokenize(params.query);

      if (queryTokens.length === 0) {
        return [];
      }

      const limit = normalizeLimit(params.limit ?? defaults.limit ?? FALLBACK_LIMIT);

      if (limit === 0) {
        return [];
      }

      const detail = normalizeDetail(params.detail ?? defaults.detail ?? "brief");
      const indexedEntries = resolvedEntries.map(indexEntry);
      const frequencies = documentFrequencies(indexedEntries);
      const averageLength = averageDocumentLength(indexedEntries);

      return indexedEntries
        .map((indexedEntry, index) => ({
          indexedEntry,
          index,
          score: bm25Score(
            indexedEntry,
            queryTokens,
            frequencies,
            indexedEntries.length,
            averageLength
          )
        }))
        .filter((scoredEntry) => scoredEntry.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, limit)
        .map((scoredEntry) => toSearchResult(scoredEntry.indexedEntry.entry, detail));
    }
  });
}
