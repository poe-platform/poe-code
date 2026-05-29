import path from "node:path";
import * as fs from "node:fs/promises";
import type { Command } from "commander";
import { confirmOrCancel } from "@poe-code/design-system";
import {
  initMemory,
  openMemory,
  resolveConfiguredMemoryRoot,
  type MemoryHandle
} from "@poe-code/memory";
import type { CliContainer } from "../container.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";

async function resolveRoot(container: CliContainer): Promise<string> {
  return resolveConfiguredMemoryRoot({
    cwd: container.env.cwd,
    env: container.env.variables,
    fs: container.fs,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath
  });
}

function resolvePageRelPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Missing page path.");
  }

  const normalized = trimmed.replaceAll("\\", "/");
  const withExt = path.posix.extname(normalized).length === 0 ? `${normalized}.md` : normalized;
  const relPath = path.posix.normalize(withExt.startsWith("pages/") ? withExt : `pages/${withExt}`);
  if (!relPath.startsWith("pages/") || relPath === "pages/.." || relPath.includes("/../")) {
    throw new ValidationError("Page path must remain under memory pages/.");
  }

  return relPath;
}

function displayPageRelPath(relPath: string): string {
  return relPath.startsWith("pages/") ? relPath.slice("pages/".length) : relPath;
}

async function assertInitialized(mem: Pick<MemoryHandle, "statusOf">): Promise<void> {
  const status = await mem.statusOf();
  if (!status.initialized) {
    throw new ValidationError(
      `Memory is not initialized. Run "poe-code memory init" in this project.`
    );
  }
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
    .command("ls")
    .description("List every page with a one-line description.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:ls");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });

      resources.logger.intro("memory ls");
      await assertInitialized(mem);

      const pages = await mem.listPages();
      if (pages.length === 0) {
        process.stdout.write("No memory pages yet.\n");
        return;
      }

      for (const page of pages) {
        const description = page.frontmatter.description?.trim() ?? "";
        process.stdout.write(
          `${displayPageRelPath(page.relPath)}${description.length > 0 ? ` — ${description}` : ""}\n`
        );
      }
    });

  memory
    .command("show")
    .description("Print a page to stdout.")
    .argument("<path>", "Page path (relative to memory pages/)")
    .action(async (pagePath: string) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:show");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });

      resources.logger.intro("memory show");
      await assertInitialized(mem);

      const relPath = resolvePageRelPath(pagePath);
      const absPath = path.join(mem.root, relPath);

      try {
        await mem.readPage(relPath);
        const content = await fs.readFile(absPath, "utf8");
        process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new ValidationError(`Page not found: ${displayPageRelPath(relPath)}`);
        }
        throw error;
      }
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

      resources.logger.intro("memory search");
      await assertInitialized(mem);

      const hits = await mem.searchMemory(query);
      if (hits.length === 0) {
        process.stdout.write("No matches.\n");
        return;
      }

      for (const hit of hits) {
        const displayPath = displayPageRelPath(hit.relPath);
        process.stdout.write(`${displayPath}:${hit.lineNumber}: ${hit.line}\n`);
      }
    });

  memory
    .command("status")
    .description("Show memory status.")
    .option("--no-tokens", "Skip token stats calculation")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "memory:status");
      const root = await resolveRoot(container);
      const mem = openMemory({ root });
      const options = this.opts<{ tokens: boolean }>();

      resources.logger.intro("memory status");
      await assertInitialized(mem);

      const status = await mem.statusOf();

      process.stdout.write(`Pages: ${status.pageCount}\n`);
      process.stdout.write(`Bytes: ${status.totalBytes}\n`);
      if (status.lastWriteAt) {
        process.stdout.write(`Last write: ${status.lastWriteAt}\n`);
      }

      if (options.tokens) {
        const tokens = await mem.computeTokenStats();
        const ratio = Number.isFinite(tokens.reductionRatio)
          ? `${tokens.reductionRatio.toFixed(2)}×`
          : "0×";
        process.stdout.write(
          `Tokens: memory=${tokens.memoryTokens}, sources=${tokens.sourceTokens}, ratio=${ratio}\n`
        );
        if (tokens.missingSources.length > 0) {
          process.stdout.write(`Missing sources: ${tokens.missingSources.join(", ")}\n`);
        }
      }
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
