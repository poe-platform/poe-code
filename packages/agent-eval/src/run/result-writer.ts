import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheatReport, EvalRunResult, SpawnEvent } from "../types.js";

export async function writeRunArtifacts(
  runDir: string,
  parts: {
    result: EvalRunResult;
    events: readonly SpawnEvent[];
    cheatReport: CheatReport;
    judge?: unknown;
    planMd: string;
    evalYaml: string;
  }
): Promise<void> {
  await mkdir(runDir, { recursive: true });

  await Promise.all([
    atomicWrite(path.join(runDir, "result.json"), `${JSON.stringify(parts.result, null, 2)}\n`),
    atomicWrite(path.join(runDir, "events.jsonl"), formatEventsJsonl(parts.events)),
    atomicWrite(
      path.join(runDir, "cheat-report.json"),
      `${JSON.stringify(parts.cheatReport, null, 2)}\n`
    ),
    atomicWrite(path.join(runDir, "plan.md"), parts.planMd),
    atomicWrite(path.join(runDir, "eval.yaml"), parts.evalYaml),
    ...(parts.judge === undefined
      ? []
      : [
          atomicWrite(
            path.join(runDir, "judge.json"),
            `${JSON.stringify(parts.judge, null, 2)}\n`
          )
        ])
  ]);
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
