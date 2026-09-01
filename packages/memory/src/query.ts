import * as fs from "node:fs/promises";
import path from "node:path";
import { countTokens } from "tokenfill";
import { spawn } from "@poe-code/agent-spawn";
import { resolveAgent } from "@poe-code/poe-code-config/core";
import { MEMORY_AGENT_JSON_CONTRACT, parseMemoryAgentResponse } from "./agent-response.js";
import { listPages } from "./pages.js";
import { MEMORY_INDEX_RELPATH } from "./paths.js";
import type { MemoryConfigOptions } from "@poe-code/poe-code-config/core";
import type { MemoryPage, MemoryRoot, QueryOptions, QueryResult } from "./types.js";

/**
 * A memory query agent inherits stdin when it has no stdin mode, so an agent that
 * never speaks would otherwise stall the caller forever. Bound the silence.
 */
const DEFAULT_QUERY_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

export type QueryContext = {
  prompt: string;
  selectedPages: MemoryPage[];
  tokensUsed: number;
  truncated: boolean;
};

export async function queryMemory(root: MemoryRoot, options: QueryOptions): Promise<QueryResult> {
  const pages = await listPages(root);
  if (pages.length === 0) {
    return {
      answer: "",
      citations: [],
      tokensUsed: 0,
      budget: options.budget,
      exitCode: 0
    };
  }

  const configOptions = {
    fs: fs as MemoryConfigOptions["fs"],
    filePath: path.join(inferRepoRoot(root), "poe-code.json"),
    projectFilePath: path.join(inferRepoRoot(root), ".poe-code", "config.json")
  } satisfies MemoryConfigOptions;
  const agentId =
    (await resolveAgent(configOptions, options.agent ?? null)) ?? options.agent ?? "claude-code";
  const context = await selectQueryContext(root, options.question, options.budget);
  const spawned = await spawn(agentId, {
    prompt: context.prompt,
    model: options.model,
    activityTimeoutMs: options.activityTimeoutMs ?? DEFAULT_QUERY_ACTIVITY_TIMEOUT_MS
  });
  const result = parseMemoryAgentResponse(spawned.stdout, { stderr: spawned.stderr });

  return {
    answer: result.answer,
    citations: result.citations,
    tokensUsed: result.tokensUsed,
    budget: options.budget,
    exitCode: spawned.exitCode
  };
}

export async function selectQueryContext(
  root: MemoryRoot,
  question: string,
  budget: number
): Promise<QueryContext> {
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("budget must be a finite non-negative number");
  }

  const [indexText, pages] = await Promise.all([
    fs.readFile(path.join(root, MEMORY_INDEX_RELPATH), "utf8"),
    listPages(root)
  ]);

  const indexTokens = countTokens(indexText);
  if (indexTokens > budget) {
    throw new Error(`budget too small; needs at least ${indexTokens} tokens`);
  }

  const rankedPages = rankPagesForQuery(pages, question);
  const selectedPages: MemoryPage[] = [];
  let tokensUsed = indexTokens;
  let truncated = false;

  for (const page of rankedPages) {
    const pageTokens = countTokens(renderPageContext(page));
    if (tokensUsed + pageTokens > budget) {
      truncated = true;
      continue;
    }

    selectedPages.push(page);
    tokensUsed += pageTokens;
  }

  return {
    prompt: buildQueryPrompt(question, indexText, selectedPages),
    selectedPages,
    tokensUsed,
    truncated
  };
}

export function rankPagesForQuery(pages: MemoryPage[], question: string): MemoryPage[] {
  const terms = tokenize(question);
  const documents = pages.map((page) => {
    const text = [page.relPath, page.frontmatter.name ?? "", page.frontmatter.description ?? "", page.body]
      .join("\n")
      .toLowerCase();
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return { page, counts, size: tokens.length };
  });

  const docFrequency = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const document of documents) {
      if ((document.counts.get(term) ?? 0) > 0) {
        count += 1;
      }
    }
    docFrequency.set(term, count);
  }

  return documents
    .map((document) => ({
      page: document.page,
      score: terms.reduce((total, term) => {
        const tf = (document.counts.get(term) ?? 0) / Math.max(document.size, 1);
        const idf = Math.log((documents.length + 1) / ((docFrequency.get(term) ?? 0) + 1)) + 1;
        return total + tf * idf;
      }, 0)
    }))
    .sort((left, right) => right.score - left.score || left.page.relPath.localeCompare(right.page.relPath))
    .map((entry) => entry.page);
}

function buildQueryPrompt(question: string, indexText: string, pages: MemoryPage[]): string {
  const renderedPages = pages.map((page) => renderPageContext(page)).join("\n\n");
  return [
    "Answer using only the provided memory pages.",
    "Cite pages and sections with [rel_path §section]. If memory does not answer the question, say so.",
    "No tools are available.",
    MEMORY_AGENT_JSON_CONTRACT,
    "",
    `Question: ${question}`,
    "",
    "INDEX.md",
    indexText,
    "",
    renderedPages
  ].join("\n");
}

function renderPageContext(page: MemoryPage): string {
  return [`FILE: ${page.relPath}`, page.body].join("\n");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function inferRepoRoot(root: string): string {
  return path.resolve(root, "..", "..");
}
