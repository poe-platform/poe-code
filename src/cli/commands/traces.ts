import parseDuration from "parse-duration";
import type { Command } from "commander";
import {
  runTraceViewer,
  type AgentTraceSource,
  type RunTraceViewerOptions
} from "@poe-code/agent-trace-viewer";
import { intro } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { resolveCommandFlags } from "./shared.js";

const TRACE_SOURCES = ["claude", "codex", "pi", "poe-code"] as const satisfies AgentTraceSource[];

interface TracesCommandOptions {
  source?: string[];
  allWorkspaces?: boolean;
  since?: string;
  limit?: string;
  json?: boolean;
}

function parseTraceSources(values: string[] | undefined): AgentTraceSource[] | undefined {
  if (values === undefined || values.length === 0) {
    return undefined;
  }

  for (const value of values) {
    if (!(TRACE_SOURCES as readonly string[]).includes(value)) {
      throw new ValidationError(
        `Unsupported trace source "${value}". Expected one of: ${TRACE_SOURCES.join(", ")}.`
      );
    }
  }

  return values as AgentTraceSource[];
}

function parseSince(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const duration = parseDuration(value);
  if (duration === null || Number.isNaN(duration) || duration <= 0) {
    throw new ValidationError(`Invalid duration for --since: "${value}".`);
  }

  return new Date(Date.now() - duration);
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    [...trimmed].some((character) => character < "0" || character > "9")
  ) {
    throw new ValidationError(`Invalid --limit value "${value}". Expected a positive integer.`);
  }

  const limit = Number.parseInt(trimmed, 10);
  if (limit <= 0) {
    throw new ValidationError(`Invalid --limit value "${value}". Expected a positive integer.`);
  }

  return limit;
}

export function registerTracesCommand(program: Command, container: CliContainer): void {
  program
    .command("traces")
    .description(
      "Browse claude, codex, pi and poe-code agent traces with context usage and breakdown."
    )
    .argument("[path]", "Path to a trace file")
    .option("--source <sources...>", "Trace sources: claude, codex, pi, poe-code")
    .option("--all-workspaces", "Read traces from every workspace, not just cwd")
    .option("--since <duration>", "Only include recently updated traces")
    .option("--limit <n>", "Maximum traces listed")
    .option("--json", "Machine-readable output")
    .action(async function (this: Command, pathArg: string | undefined) {
      const options = this.opts<TracesCommandOptions>();
      const flags = resolveCommandFlags(program);
      const json = options.json === true;

      if (!json) {
        intro("traces");
      }

      await runTraceViewer({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        fs: container.fs as RunTraceViewerOptions["fs"],
        assumeYes: flags.assumeYes,
        path: pathArg,
        sources: parseTraceSources(options.source),
        allWorkspaces: true,
        since: parseSince(options.since),
        limit: parseLimit(options.limit),
        json
      });
    });
}
