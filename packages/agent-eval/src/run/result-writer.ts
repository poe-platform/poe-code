import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheatReport, EvalRunResult, SpawnEvent } from "../types.js";
import type { NormalizedTrace } from "./trace/types.js";

export async function writeRunArtifacts(
  runDir: string,
  parts: {
    result: EvalRunResult;
    events: readonly SpawnEvent[];
    trace: NormalizedTrace;
    cheatReport: CheatReport;
    judge?: unknown;
    planMd: string;
    evalYaml: string;
  }
): Promise<void> {
  await writeRunEvidence(runDir, parts);
  await writeRunCompletion(runDir, parts);
}

export async function writeRunEvidence(
  runDir: string,
  parts: {
    events: readonly SpawnEvent[];
    trace: NormalizedTrace;
    cheatReport: CheatReport;
    planMd: string;
    evalYaml: string;
  }
): Promise<void> {
  await mkdir(runDir, { recursive: true });

  await Promise.all([
    atomicWrite(path.join(runDir, "events.jsonl"), formatEventsJsonl(parts.events)),
    atomicWrite(path.join(runDir, "trace.json"), `${JSON.stringify(parts.trace, null, 2)}\n`),
    atomicWrite(
      path.join(runDir, "cheat-report.json"),
      `${JSON.stringify(parts.cheatReport, null, 2)}\n`
    ),
    atomicWrite(path.join(runDir, "plan.md"), parts.planMd),
    atomicWrite(path.join(runDir, "eval.yaml"), parts.evalYaml)
  ]);
}

export async function writeRunCompletion(
  runDir: string,
  parts: { result: EvalRunResult; judge?: unknown }
): Promise<void> {
  if (parts.judge !== undefined) {
    await atomicWrite(path.join(runDir, "judge.json"), `${JSON.stringify(parts.judge, null, 2)}\n`);
  }
  await writeRunResult(runDir, parts.result);
}

export async function writeRunResult(runDir: string, result: EvalRunResult): Promise<void> {
  await atomicWrite(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

function formatEventsJsonl(events: readonly SpawnEvent[]): string {
  if (events.length === 0) {
    return "";
  }
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}
