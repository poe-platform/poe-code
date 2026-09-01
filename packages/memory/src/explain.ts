import * as fs from "node:fs/promises";
import path from "node:path";
import { countTokens } from "tokenfill";
import { spawn } from "@poe-code/agent-spawn";
import { resolveAgent } from "@poe-code/poe-code-config/core";
import { MEMORY_AGENT_JSON_CONTRACT, parseMemoryAgentResponse } from "./agent-response.js";
import { hasOwnErrorCode } from "./errors.js";
import { readPage } from "./pages.js";
import { selectQueryContext } from "./query.js";
import type { MemoryConfigOptions } from "@poe-code/poe-code-config/core";
import type { ExplainResult, MemoryPage, MemoryRoot, SourceRef } from "./types.js";

export type ExplainOptions = {
  relPath: string;
  budget: number;
  agent?: string;
  model?: string;
};

export async function explainPage(
  root: MemoryRoot,
  options: ExplainOptions
): Promise<ExplainResult> {
  const targetPage = await readPageIfPresent(root, options.relPath);
  if (targetPage === undefined) {
    return {
      answer: "",
      citations: [],
      tokensUsed: 0,
      budget: options.budget,
      exitCode: 0,
      inboundPages: [],
      outboundSources: []
    };
  }

  const allContext = await selectQueryContext(root, options.relPath, Number.MAX_SAFE_INTEGER);
  const relatedPages = collectRelatedPages(allContext.selectedPages, targetPage.relPath, targetPage.frontmatter.sources ?? []);
  const prompt = buildExplainPrompt(targetPage.relPath, relatedPages);
  const tokensUsed = countTokens(prompt);
  if (tokensUsed > options.budget) {
    throw new Error(`budget too small; needs at least ${tokensUsed} tokens`);
  }

  const configOptions = {
    fs: fs as MemoryConfigOptions["fs"],
    filePath: path.join(inferRepoRoot(root), "poe-code.json"),
    projectFilePath: path.join(inferRepoRoot(root), ".poe-code", "config.json")
  } satisfies MemoryConfigOptions;
  const agentId =
    (await resolveAgent(configOptions, options.agent ?? null)) ?? options.agent ?? "claude-code";
  const spawned = await spawn(agentId, { prompt, model: options.model });
  const response = parseMemoryAgentResponse(spawned.stdout, { stderr: spawned.stderr });

  return {
    answer: response.answer,
    citations: response.citations,
    tokensUsed: response.tokensUsed,
    budget: options.budget,
    exitCode: spawned.exitCode,
    inboundPages: relatedPages
      .filter((page) => page.relPath !== targetPage.relPath)
      .filter((page) => (page.frontmatter.sources ?? []).some((source) => source.path === targetPage.relPath))
      .map((page) => page.relPath),
    outboundSources: targetPage.frontmatter.sources ?? []
  };
}

function collectRelatedPages(
  pages: MemoryPage[],
  targetRelPath: string,
  outboundSources: SourceRef[]
): MemoryPage[] {
  const memorySourcePaths = new Set(outboundSources.map((source) => source.path));
  return pages.filter((page) => {
    if (page.relPath === targetRelPath) {
      return true;
    }

    if (memorySourcePaths.has(page.relPath)) {
      return true;
    }

    return (page.frontmatter.sources ?? []).some((source) => source.path === targetRelPath);
  });
}

function buildExplainPrompt(targetRelPath: string, pages: MemoryPage[]): string {
  return [
    "Summarize the target page using only the provided memory pages.",
    "Return a 1-2 paragraph explanation plus the important inbound/outbound links.",
    "Cite pages and sections with [rel_path §section]. If memory is insufficient, say so.",
    "No tools are available.",
    MEMORY_AGENT_JSON_CONTRACT,
    "",
    `Target page: ${targetRelPath}`,
    "",
    ...pages.map((page) => [`FILE: ${page.relPath}`, page.body].join("\n"))
  ].join("\n\n");
}

async function readPageIfPresent(root: MemoryRoot, relPath: string): Promise<MemoryPage | undefined> {
  try {
    return await readPage(root, relPath);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

function inferRepoRoot(root: string): string {
  return path.resolve(root, "..", "..");
}
