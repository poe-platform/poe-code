import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { dirname, resolvePath } from "../../src/index.js";
import type { MemoryFileSystem } from "../../src/index.js";
import { maxBatchCases } from "./model.js";
import type { BatchRequest, ChildRequest, Observation, ScriptOutcome, Snapshot } from "./model.js";
import { runProbe, runtime } from "./probes.js";

async function snapshot(fs: MemoryFileSystem, directory = "/"): Promise<Snapshot> {
  const files: Snapshot = {};
  for (const entry of await fs.readdir(directory)) {
    const path = resolvePath(directory, entry.name);
    const key = path.slice(1);
    if (entry.type === "directory") {
      files[key] = { type: "directory" };
      Object.assign(files, await snapshot(fs, path));
    } else {
      if (entry.type !== "file") throw new Error(`Unexpected non-regular virtual artifact: ${key}`);
      files[key] = { type: "file", base64: Buffer.from(await fs.readFile(path)).toString("base64") };
    }
  }
  return files;
}

async function runRequest(request: ChildRequest): Promise<Observation | { passed: string }> {
  const independentWatchdog = new Worker('const {workerData} = require("node:worker_threads"); setTimeout(() => process.kill(-workerData, "SIGKILL"), 4500);', { eval: true, workerData: process.pid });
  const watchdog = setTimeout(() => { throw new Error("Virtual child cooperative watchdog exceeded"); }, 4000);
  try {
    if (request.kind === "probe") {
      if (!request.probe) throw new Error("Missing probe");
      await runProbe(request.probe);
      return { passed: request.probe };
    } else {
      const fixture = request.fixture;
      if (!fixture) throw new Error("Missing fixture");
      const { shell, fs } = runtime();
      try {
        for (const [name, content] of Object.entries(fixture.initialFiles ?? {})) {
          const path = resolvePath("/", name);
          await fs.mkdir(dirname(path), { recursive: true });
          await fs.writeFile(path, new TextEncoder().encode(content));
        }
        const result = await shell.exec(fixture.script, {
          stdin: fixture.stdin ?? "", env: fixture.env ?? {}, limits: fixture.limits ?? {},
          signal: AbortSignal.timeout(3500),
        });
        const observation: Observation = {
          stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, files: await snapshot(fs),
          stdoutBase64: Buffer.from(result.stdoutBytes).toString("base64"), stderrBase64: Buffer.from(result.stderrBytes).toString("base64"),
        };
        return observation;
      } finally { await shell.dispose(); }
    }
  } finally {
    clearTimeout(watchdog);
    await independentWatchdog.terminate();
  }
}

const request = JSON.parse(readFileSync(0, "utf8")) as ChildRequest | BatchRequest;
if (request.kind === "batch") {
  if (!Array.isArray(request.fixtures) || request.fixtures.length < 1 || request.fixtures.length > maxBatchCases) throw new Error("Invalid virtual batch size");
  const outcomes: ScriptOutcome[] = [];
  for (const fixture of request.fixtures) {
    try {
      const observation = await runRequest({ kind: "script", fixture });
      if (!("exitCode" in observation)) throw new Error("Expected script observation");
      outcomes.push({ name: fixture.name, status: "fulfilled", observation });
    } catch (error) {
      outcomes.push({ name: fixture.name, status: "rejected", error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
  }
  console.log(JSON.stringify(outcomes));
} else {
  console.log(JSON.stringify(await runRequest(request)));
}
