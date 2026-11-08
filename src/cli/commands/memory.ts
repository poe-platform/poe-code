import path from "node:path";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import parseDuration from "parse-duration";
import { Option, type Command } from "commander";
import { listAgentsWithCapability } from "@poe-code/agent-defs";
import { confirmOrCancel, getTheme, renderTable } from "toolcraft-design";
import { DEFAULT_QUERY_BUDGET_TOKENS, defaultQueryBudget } from "@poe-code/poe-code-config/core";
import {
  cacheStatus,
  clearCache,
  editPage,
  initMemory,
  installMemory,
  openMemory,
  resolveConfiguredMemoryRoot,
  type MemoryHandle
} from "@poe-code/memory";
import memorySkillTemplate from "../../../packages/memory/src/templates/SKILL_memory.md";
import type { CliContainer } from "../container.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { ValidationError } from "../errors.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import {
  createExecutionResources,
  requireInteractiveStdin,
  resolveCommandFlags,
  shlexQuote
} from "./shared.js";

function memoryInstallAgents(): string[] {
  return [
    ...new Set([
      ...listAgentsWithCapability("skill", { includeAliases: true }),
      ...listAgentsWithCapability("mcp", { includeAliases: true })
    ])
  ];
}

async function resolveRoot(container: CliContainer): Promise<string> {
  return resolveConfiguredMemoryRoot({
    cwd: container.env.cwd,
    env: container.env.variables,
    fs: container.fs,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath
  });
}

function resolvePageRelPathCandidates(input: string): [string, ...string[]] {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Missing page path.");
  }

  const normalized = trimmed.replaceAll("\\", "/");
  const withExt = path.posix.extname(normalized).length === 0 ? `${normalized}.md` : normalized;
  const relPath = path.posix.normalize(withExt);
  if (
    path.posix.isAbsolute(relPath) ||
    relPath === ".." ||
    relPath.startsWith("../") ||
    relPath === "."
  ) {
    throw new ValidationError("Page path must remain under the memory root.");
  }

  return relPath.startsWith("pages/") ? [relPath] : [relPath, `pages/${relPath}`];
}

function resolvePageRelPath(input: string): string {
  const [rootRelPath, pagesRelPath] = resolvePageRelPathCandidates(input);
  return pagesRelPath ?? rootRelPath;
}

function displayPageRelPath(relPath: string): string {
  return relPath.startsWith("pages/") ? relPath.slice("pages/".length) : relPath;
}

function parseCacheOlderThan(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const duration = parseDuration(value);
  if (duration === null || Number.isNaN(duration) || duration < 0) {
    throw new ValidationError(`Invalid duration for --older-than: "${value}".`);
  }
  return duration;
}

function formatCacheDryRunMessage(olderThan: string | undefined): string {
  if (olderThan === undefined) {
    return "Would clear all memory cache entries.";
  }
  return `Would clear memory cache entries older than ${olderThan}.`;
}

async function assertInitialized(mem: Pick<MemoryHandle, "statusOf">): Promise<void> {
  const status = await mem.statusOf();
  if (!status.initialized) {
    throw new ValidationError(
      `Memory is not initialized. Run "poe-code memory init" in this project.`
    );
  }
}

async function queryBudget(container: CliContainer, value: string | undefined): Promise<number> {
  if (value !== undefined) {
    const budget = Number(value);
    if (Number.isFinite(budget) && budget >= 0) {
      return budget;
    }
    throw new ValidationError("Budget must be a finite non-negative number.");
  }

  return defaultQueryBudget({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath
  });
}

function parseDecimalNonNegativeInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isDecimalNonNegativeIntegerText(value)) {
    throw new ValidationError(`${label} must be a decimal non-negative integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(`${label} must be a decimal non-negative integer.`);
  }

  return parsed;
}

function isDecimalNonNegativeIntegerText(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  if (value.length > 1 && value[0] === "0") {
    return false;
  }

  return [...value].every((char) => char >= "0" && char <= "9");
}

async function readCommandContent(content: string | undefined): Promise<string> {
  if (content !== undefined) {
    return content;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveEditor(container: CliContainer): string {
  const editor = container.env.getVariable("EDITOR") ?? container.env.getVariable("VISUAL");
  if (editor === undefined || editor.trim().length === 0) {
    throw new ValidationError("Set $EDITOR to use this command.");
  }
  return editor.trim();
}

async function resolveIngestSource(
  cwd: string,
  input: string
): Promise<{ kind: "url"; url: string } | { kind: "file"; absPath: string }> {
  try {
    const url = new URL(input);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "url", url: url.toString() };
    }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
  }

  const absPath = path.resolve(cwd, input);
  try {
    await fs.stat(absPath);
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
    throw new ValidationError(
      `Source not found: ${absPath}. Provide a readable file path or an http(s) URL.`
    );
  }

  return { kind: "file", absPath };
}

export function registerMemoryCommand(program: Command, container: CliContainer): void {
  const memory = program
    .command("memory")
    .description("Persistent memory directory commands.")
    .allowExcessArguments()
    .action(function (this: Command) {
      if (this.args.length > 0) {
        throwCommandNotFound({
          container,
          scope: "cli",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["memory", "--help"],
          moduleUrl: import.meta.url
        });
      }
      this.help();
    });

  memory
    .command("init")
    .description("Create .poe-code/memory/ with empty INDEX.md and LOG.md.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:init");
      const root = await resolveRoot(container);

      resources.logger.intro("memory init");

      if (flags.dryRun) {
        resources.logger.dryRun(`Would initialize memory at ${root}`);
        return;
      }

      await initMemory(root);
      resources.context.complete({
        success: `Initialized memory at ${path.relative(container.env.cwd, root)}`,
        dry: `Would initialize memory at ${path.relative(container.env.cwd, root)}`
      });
      resources.context.finalize();
    });

  memory
    .command("list")
    .alias("ls")
    .description("List every memory file with a one-line description.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:list");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });

      await assertInitialized(mem);

      const pages = await mem.listMemoryFiles();

      resources.logger.intro("memory list");

      if (pages.length === 0) {
        resources.logger.info("No memory pages yet.");
        resources.logger.nextSteps(['Run "poe-code memory write <page> --reason <text>" to add one.']);
        return;
      }

      resources.logger.info(
        renderTable({
          theme: getTheme(),
          columns: [
            { name: "Page", title: "Page", alignment: "left", maxLen: 48 },
            { name: "Description", title: "Description", alignment: "left", maxLen: 72 }
          ],
          rows: pages.map((page) => ({
            Page: displayPageRelPath(page.relPath),
            Description: page.frontmatter.description?.trim() ?? ""
          }))
        })
      );
    });

  memory
    .command("show")
    .description("Print a page to stdout.")
    .argument("<path>", "Page path (relative to the memory root, or to memory pages/)")
    .action(async (pagePath: string) => {
      const root = await resolveRoot(container);
      const mem = openMemory({ root });

      await assertInitialized(mem);

      const candidates = resolvePageRelPathCandidates(pagePath);

      for (const relPath of candidates) {
        try {
          await mem.readPage(relPath);
          const content = await fs.readFile(path.join(mem.root, relPath), "utf8");
          process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
          return;
        } catch (error) {
          if (!hasOwnErrorCode(error, "ENOENT")) {
            throw error;
          }
        }
      }

      throw new ValidationError(`Page not found: ${candidates.join(" or ")}`);
    });

  memory
    .command("search")
    .description("Search over memory files for a substring.")
    .argument("<query>", "Search query")
    .action(async (query: string) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:search");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });

      await assertInitialized(mem);

      const hits = await mem.searchMemory(query);

      resources.logger.intro("memory search");

      if (hits.length === 0) {
        resources.logger.info(`No matches for "${query}".`);
        return;
      }

      resources.logger.info(
        renderTable({
          theme: getTheme(),
          columns: [
            { name: "Page", title: "Page", alignment: "left", maxLen: 40 },
            { name: "Line", title: "Line", alignment: "right", maxLen: 6 },
            { name: "Match", title: "Match", alignment: "left", maxLen: 72 }
          ],
          rows: hits.map((hit) => ({
            Page: displayPageRelPath(hit.relPath),
            Line: String(hit.lineNumber),
            Match: hit.line.trim()
          }))
        })
      );
    });

  memory
    .command("write")
    .description("Replace a page with content read from stdin.")
    .argument("<path>", "Page path (relative to memory pages/)")
    .requiredOption("--reason <text>", "Reason for the memory update")
    .option("--content <text>", "Page content instead of stdin")
    .action(async (pagePath: string, options: { reason: string; content?: string }) => {
      const flags = resolveCommandFlags(program);
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const relPath = resolvePageRelPath(pagePath);
      const content = await readCommandContent(options.content);
      const resources = createExecutionResources(container, flags, "memory:write");
      if (flags.dryRun) {
        resources.logger.dryRun(`Would write ${relPath}.`);
        return;
      }
      await mem.writePage(relPath, content, { reason: options.reason });
      resources.logger.success(`Wrote ${relPath} (${options.reason})`);
    });

  memory
    .command("append")
    .description("Append stdin content to a page.")
    .argument("<path>", "Page path (relative to memory pages/)")
    .option("--reason <text>", "Reason for the memory update", "append")
    .option("--content <text>", "Content instead of stdin")
    .action(async (pagePath: string, options: { reason: string; content?: string }) => {
      const flags = resolveCommandFlags(program);
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const relPath = resolvePageRelPath(pagePath);
      const content = await readCommandContent(options.content);
      const resources = createExecutionResources(container, flags, "memory:append");
      if (flags.dryRun) {
        resources.logger.dryRun(`Would append to ${relPath}.`);
        return;
      }
      await mem.appendToPage(relPath, content, { reason: options.reason });
      resources.logger.success(`Appended to ${relPath} (${options.reason})`);
    });

  memory
    .command("edit")
    .description("Open a page in $EDITOR.")
    .argument("<path>", "Page path (relative to memory pages/)")
    .option("--reason <text>", "Reason for the memory update", "edit")
    .action(async (pagePath: string, options: { reason: string }) => {
      const flags = resolveCommandFlags(program);
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const relPath = resolvePageRelPath(pagePath);
      const editor = resolveEditor(container);
      if (flags.dryRun) {
        createExecutionResources(container, flags, "memory:edit").logger.dryRun(`Would open ${relPath} in ${editor}.`);
        return;
      }
      await editPage(root, relPath, {
        reason: options.reason,
        launchEditor: async (filePath) => {
          execSync(`${editor} ${shlexQuote(filePath)}`, { stdio: "inherit" });
        }
      });
    });

  memory
    .command("ingest")
    .description("Fold a file or URL into memory through an agent.")
    .argument("<source>", "Local file path or URL")
    .option("--agent <agent>", "Agent override")
    .option("--reason <text>", "Reason for ingest")
    .option("--timeout-ms <ms>", "Timeout in milliseconds")
    .option("--force", "Bypass an existing cache hit")
    .option("--no-cache-write", "Skip cache persistence")
    .action(async (source: string, options: { agent?: string; reason?: string; timeoutMs?: string; force?: boolean; cacheWrite?: boolean }) => {
      const flags = resolveCommandFlags(program);
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const timeoutMs = parseDecimalNonNegativeInteger(options.timeoutMs, "Timeout");
      const result = await mem.ingest({
        source: await resolveIngestSource(container.env.cwd, source),
        agent: options.agent,
        reason: options.reason,
        timeoutMs,
        force: options.force,
        noCacheWrite: options.cacheWrite === false,
        dryRun: flags.dryRun
      });
      process.stdout.write(`${result.cacheHit ? "Cache hit" : "Ingested"}: ${result.diff.created.length} created, ${result.diff.updated.length} updated, ${result.diff.deleted.length} deleted.\n`);
    });

  memory
    .command("lint")
    .description("Audit memory confidence and provenance claims.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:lint");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const audits = await mem.auditClaims({ repoRoot: container.env.cwd });

      resources.logger.intro("memory lint");

      if (audits.length === 0) {
        resources.logger.success("No memory lint issues.");
        return;
      }

      resources.logger.info(
        renderTable({
          theme: getTheme(),
          columns: [
            { name: "Page", title: "Page", alignment: "left", maxLen: 40 },
            { name: "Issue", title: "Issue", alignment: "left", maxLen: 72 }
          ],
          rows: audits.flatMap((audit) =>
            audit.issues.map((issue) => ({ Page: audit.page, Issue: issue }))
          )
        })
      );
    });

  memory
    .command("query")
    .description("Answer a question using memory-only context.")
    .argument("<question>", "Natural-language question to answer using stored memory pages")
    .option("--budget <tokens>", `Max tokens of memory context sent to the agent (default: ${DEFAULT_QUERY_BUDGET_TOKENS})`)
    .option("--agent <agent>", "Agent to answer the question, instead of the configured memory agent")
    .option("--model <model>", "Model identifier override passed to the agent")
    .action(async (question: string, options: { budget?: string; agent?: string; model?: string }) => {
      const flags = resolveCommandFlags(program);
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const budget = await queryBudget(container, options.budget);
      if (flags.dryRun) {
        createExecutionResources(container, flags, "memory:query").logger.dryRun(
          `Would query memory with budget ${budget}.`
        );
        return;
      }
      const result = await mem.query({
        question,
        budget,
        agent: options.agent,
        model: options.model
      });
      process.stdout.write(`${result.answer}\n`);
    });

  memory
    .command("explain")
    .description("Summarize a memory page and its relationships.")
    .argument("<path>", "Page to summarize (relative to memory pages/)")
    .option("--budget <tokens>", `Max tokens of memory context sent to the agent (default: ${DEFAULT_QUERY_BUDGET_TOKENS})`)
    .option("--agent <agent>", "Agent to write the summary, instead of the configured memory agent")
    .option("--model <model>", "Model identifier override passed to the agent")
    .action(async (pagePath: string, options: { budget?: string; agent?: string; model?: string }) => {
      const flags = resolveCommandFlags(program);
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      await assertInitialized(mem);
      const relPath = resolvePageRelPath(pagePath);
      const budget = await queryBudget(container, options.budget);
      if (flags.dryRun) {
        createExecutionResources(container, flags, "memory:explain").logger.dryRun(
          `Would explain ${relPath} with budget ${budget}.`
        );
        return;
      }
      const result = await mem.explainPage({
        relPath,
        budget,
        agent: options.agent,
        model: options.model
      });
      process.stdout.write(`${result.answer}\n`);
    });

  memory
    .command("install")
    .description("Install the memory skill and MCP server configuration.")
    // The skill and the MCP server support different agents, and --skill-only /
    // --mcp-only ask for one of them, so every agent with either capability is
    // accepted here; installMemory reports a real capability gap.
    .addOption(
      new Option("--agent <agent>", "Target agent")
        .choices(memoryInstallAgents())
        .makeOptionMandatory()
    )
    .option("--global", "Install skill globally")
    .option("--skill-only", "Install only the skill")
    .option("--mcp-only", "Configure only the MCP server")
    .option("--allow-writes", "Allow MCP append writes")
    .option("--force", "Overwrite an existing memory skill")
    .action(async (options: { agent: string; global?: boolean; skillOnly?: boolean; mcpOnly?: boolean; allowWrites?: boolean; force?: boolean }) => {
      const flags = resolveCommandFlags(program);
      await installMemory({
        agent: options.agent,
        skillContent: memorySkillTemplate,
        fs: container.fs,
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        platform: container.env.platform as "darwin" | "linux" | "win32",
        scope: options.global ? "global" : "local",
        skillOnly: options.skillOnly,
        mcpOnly: options.mcpOnly,
        allowWrites: options.allowWrites,
        force: options.force,
        dryRun: flags.dryRun
      });
    });

  memory
    .command("status")
    .description("Show memory status.")
    .option("--no-tokens", "Skip token stats calculation")
    .action(async function (this: Command) {
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      const options = this.opts<{ tokens: boolean }>();

      await assertInitialized(mem);

      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:status");
      const status = await mem.statusOf();

      resources.logger.intro("memory status");
      resources.logger.resolved("Pages", String(status.pageCount));
      resources.logger.resolved("Bytes", String(status.totalBytes));
      resources.logger.resolved("Last write", status.lastWriteAt ?? "never");

      if (options.tokens) {
        const tokens = await mem.computeTokenStats();
        const ratio = Number.isFinite(tokens.reductionRatio)
          ? `${tokens.reductionRatio.toFixed(2)}×`
          : "0×";
        resources.logger.resolved(
          "Tokens",
          `memory=${tokens.memoryTokens}, sources=${tokens.sourceTokens}, ratio=${ratio}`
        );
        resources.logger.info(
          "Ratio is source tokens divided by memory tokens: how much source text each memory token stands in for. It stays 0 until pages record sources."
        );
        if (tokens.missingSources.length > 0) {
          resources.logger.warn(`Missing sources: ${tokens.missingSources.join(", ")}`);
        }
      }

      resources.logger.nextSteps([
        'Run "poe-code memory list" to see pages, or "poe-code memory search <query>" to find one.'
      ]);
    });

  const cache = memory
    .command("cache")
    .description("Inspect or clear ingest cache entries.");

  cache
    .command("status")
    .description("Show ingest cache entry count and bytes.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:cache:status");
      const status = await cacheStatus(await resolveRoot(container));
      resources.logger.info(
        `${status.entries} cache ${status.entries === 1 ? "entry" : "entries"} (${status.bytes} bytes)`
      );
    });

  cache
    .command("clear")
    .description("Clear ingest cache entries.")
    .option("--older-than <duration>", "Clear entries older than the duration.")
    .action(async (options: { olderThan?: string }) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:cache:clear");
      if (!flags.assumeYes) {
        throw new Error("Refusing to clear cache without --yes.");
      }

      const olderThanMs = parseCacheOlderThan(options.olderThan);
      if (flags.dryRun) {
        resources.logger.dryRun(formatCacheDryRunMessage(options.olderThan));
        return;
      }

      const result = await clearCache(
        await resolveRoot(container),
        olderThanMs === undefined ? {} : { olderThanMs }
      );
      resources.logger.info(
        `removed ${result.removed} cache ${result.removed === 1 ? "entry" : "entries"}`
      );
    });

  memory
    .command("clear")
    .description("Delete all memory content and re-initialize INDEX.md and LOG.md.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:clear");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });

      resources.logger.intro("memory clear");
      await assertInitialized(mem);

      if (!flags.assumeYes) {
        requireInteractiveStdin(
          "memory clear requires --yes when running without an interactive TTY."
        );

        await confirmOrCancel({
          message: "Clear all memory pages and cache?"
        });
      }

      if (flags.dryRun) {
        resources.logger.dryRun(`Would clear memory at ${mem.root}`);
        return;
      }

      await mem.clearMemory();
      resources.context.complete({
        success: "Cleared memory.",
        dry: "Would clear memory."
      });
      resources.context.finalize();
    });
}
