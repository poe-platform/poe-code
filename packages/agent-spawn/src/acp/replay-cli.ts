#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTheme, renderTable } from "@poe-code/design-system";
import { findLatestLog, listSpawnLogs, pickRandomLog, replaySpawnLog } from "./replay.js";

type ReplayCommand =
  | { kind: "list" }
  | { kind: "latest"; agent?: string }
  | { kind: "random"; agent?: string }
  | { kind: "file"; filePath: string };

function formatNoLogsMessage(agent?: string): string {
  return agent ? `No spawn logs found for agent "${agent}".` : "No spawn logs found.";
}

function takeOptionalAgent(args: string[]): { agent?: string; rest: string[] } {
  const [first, ...rest] = args;

  if (typeof first !== "string" || first.length === 0 || first.startsWith("-")) {
    return { rest: args };
  }

  return {
    agent: first,
    rest
  };
}

function parseReplayCommand(args: string[]): ReplayCommand {
  const [first, ...rest] = args;

  if (typeof first !== "string") {
    return { kind: "latest" };
  }

  if (first === "--list") {
    if (rest.length > 0) {
      throw new Error("--list does not accept additional arguments.");
    }
    return { kind: "list" };
  }

  if (first === "--latest") {
    const { agent, rest: remaining } = takeOptionalAgent(rest);
    if (remaining.length > 0) {
      throw new Error("--latest accepts at most one optional agent argument.");
    }
    return { kind: "latest", agent };
  }

  if (first === "--random") {
    const { agent, rest: remaining } = takeOptionalAgent(rest);
    if (remaining.length > 0) {
      throw new Error("--random accepts at most one optional agent argument.");
    }
    return { kind: "random", agent };
  }

  if (first.startsWith("-")) {
    throw new Error(`Unknown option: ${first}`);
  }

  if (rest.length > 0) {
    throw new Error("Only one replay target file may be provided.");
  }

  return {
    kind: "file",
    filePath: path.resolve(first)
  };
}

function renderLogTable(entries: Awaited<ReturnType<typeof listSpawnLogs>>): string {
  return renderTable({
    theme: getTheme(),
    columns: [
      { name: "filename", title: "Filename", alignment: "left", maxLen: 36 },
      { name: "agent", title: "Agent", alignment: "left", maxLen: 18 },
      { name: "timestamp", title: "Timestamp", alignment: "left", maxLen: 24 },
      { name: "path", title: "Path", alignment: "left", maxLen: 80 }
    ],
    rows: entries.map((entry) => ({
      filename: entry.filename,
      agent: entry.agent ?? "",
      timestamp: entry.timestamp?.toISOString() ?? "",
      path: entry.path
    }))
  });
}

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, value: string): void {
  stream.write(value.endsWith("\n") ? value : `${value}\n`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    const command = parseReplayCommand(argv.slice(2));

    if (command.kind === "list") {
      const entries = await listSpawnLogs();
      writeLine(process.stdout, entries.length === 0 ? "No spawn logs found." : renderLogTable(entries));
      return;
    }

    if (command.kind === "file") {
      await replaySpawnLog(command.filePath);
      return;
    }

    if (command.kind === "latest") {
      const filePath = await findLatestLog(command.agent);
      if (filePath === undefined) {
        throw new Error(formatNoLogsMessage(command.agent));
      }
      await replaySpawnLog(filePath);
      return;
    }

    const filePath = await pickRandomLog(command.agent);
    if (filePath === undefined) {
      throw new Error(formatNoLogsMessage(command.agent));
    }

    writeLine(process.stderr, filePath);
    await replaySpawnLog(filePath);
  } catch (error) {
    writeLine(process.stderr, getErrorMessage(error));
    process.exitCode = 1;
  }
}

async function isDirectExecution(argv: string[]): Promise<boolean> {
  const entryPoint = argv[1];

  if (typeof entryPoint !== "string" || entryPoint.length === 0) {
    return false;
  }

  try {
    const modulePath = fileURLToPath(import.meta.url);
    const [resolvedEntryPoint, resolvedModulePath] = await Promise.all([
      realpath(path.resolve(entryPoint)),
      realpath(modulePath)
    ]);

    return resolvedEntryPoint === resolvedModulePath;
  } catch {
    return false;
  }
}

if (await isDirectExecution(process.argv)) {
  await main();
}
