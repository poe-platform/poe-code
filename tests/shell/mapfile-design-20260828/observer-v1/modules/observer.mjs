import path from "node:path";
import { authenticate } from "./admission.mjs";
import { OwnedStorage } from "./storage.mjs";
import { observeChild } from "./lifecycle.mjs";

export const moduleUrl = import.meta.url;
export async function runObserver(port, input) {
  const config = JSON.parse(JSON.stringify(input));
  const report = { schema: "mapfile-observer-result-v1", mode: config.mode, rows: [], failures: [], directories: [], remaining: config.rowIds?.slice() ?? [], nativeSemanticPasses: 0 };
  const storage = new OwnedStorage(port, config.outputRoot);
  const deadline = port.now() + 150000;
  const outputBudget = { limit: 1048576, retained: 0 };
  const failure = (phase, error) => report.failures.push({ phase, message: error.message ?? String(error) });
  try {
    const rows = authenticate(port, config);
    storage.acquire(config.outputRoot);
    storage.acquire(path.join(config.outputRoot, "records"));
    storage.acquire(path.join(config.outputRoot, "fixture"));
    storage.acquire(path.join(config.outputRoot, "fixture/home"));
    storage.acquire(path.join(config.outputRoot, "fixture/tmp"));
    for (const row of rows) {
      if (port.now() >= deadline) throw new Error("whole-run admission deadline");
      authenticate(port, config);
      const record = { id: row.id, scriptSha256: row.scriptSha256, stdinSha256: row.stdinSha256 };
      report.rows.push(record); report.remaining.shift();
      const fixture = path.join(config.outputRoot, "fixture");
      const spec = { executable: config.binary, args: ["--noprofile", "--norc", "-c", row.script, "mapfile-design-v1"], cwd: fixture, stdin: Buffer.from(row.stdinHex, "hex"), env: { PATH: "", ENV: "", BASH_ENV: "", HOME: path.join(fixture, "home"), TMPDIR: path.join(fixture, "tmp"), LANG: "C", LC_ALL: "C", TZ: "UTC" } };
      record.binding = { executable: spec.executable, args: spec.args, cwd: spec.cwd, env: spec.env, stdinHex: row.stdinHex };
      await observeChild(port, spec, record, (name, value) => storage.write(name, value), outputBudget, deadline);
      storage.write(`row-${row.id}.json`, record);
      storage.audit();
      authenticate(port, config);
      if (record.fault || record.terminal !== "closed-and-group-absent") throw new Error(record.fault ?? record.terminal);
    }
  } catch (error) { failure("execution", error); }
  finally {
    for (const error of storage.cleanupFixture()) failure("cleanup", error);
    try { storage.audit(); } catch (error) { failure("cleanup-integrity", error); }
    try { authenticate(port, config); } catch (error) { failure("final-integrity", error); }
    if (port.now() > deadline) failure("whole-deadline", new Error("whole-run terminal deadline exceeded"));
    report.directories = storage.directories;
    report.receipts = storage.files;
    report.outputBytesRetained = outputBudget.retained;
    report.success = report.failures.length === 0;
    report.launched = report.rows.filter(row => row.spawnObserved).length;
    report.spawnCalls = report.rows.filter(row => row.spawnCalled).length;
    report.actualCloseEvents = report.rows.filter(row => row.closeObserved).length;
    report.cleanupUncertain = report.rows.some(row => row.terminal === "terminal-cleanup-uncertain") || report.failures.some(row => row.phase.startsWith("cleanup"));
    try { storage.write("final.json", { ...report, success: undefined, phase: "PROVISIONAL_BEFORE_FINAL_CONTROL_AUTHENTICATION" }); } catch (error) { failure("final-persistence", error); report.success = false; }
    try { authenticate(port, config); } catch (error) { failure("post-persistence-integrity", error); report.success = false; }
    if (port.now() > deadline) { failure("whole-deadline", new Error("whole-run terminal deadline exceeded")); report.success = false; }
    report.elapsed = port.now() - (deadline - 150000);
  }
  return report;
}
