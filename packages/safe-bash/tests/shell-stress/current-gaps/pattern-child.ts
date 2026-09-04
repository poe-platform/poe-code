import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { matchesPattern } from "../../../src/shell/pattern.js";

const request = JSON.parse(readFileSync(0, "utf8")) as { length: number; mode: "matcher" | "shell"; matching?: boolean };
if (!Number.isSafeInteger(request.length) || request.length < 1 || request.length > 65536) throw new Error("Invalid bounded pattern length");
if (request.matching !== undefined && typeof request.matching !== "boolean") throw new Error("Invalid matching control");
const pattern = request.matching ? "x" : "[".repeat(request.length);
const shellRuntime = request.mode === "shell" ? await Promise.all([
  import("../../../src/shell/shell.js"), import("../../../src/fs/memory/index.js"),
]) : undefined;
const controller = new AbortController();
const reason = new Error("independent case-pattern cancellation");
const timer = request.matching ? undefined : setTimeout(() => controller.abort(reason), 10);
const started = performance.now();
let outcome: unknown;
try {
  if (request.mode === "matcher") {
    outcome = await matchesPattern(pattern, "x", {
      remaining: 1048576,
      signal: controller.signal,
      exhausted() { throw new Error("pattern budget exhausted"); },
    });
  } else {
    const [{ Shell }, { MemoryFileSystem }] = shellRuntime!;
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs });
    try {
      const result = await shell.exec('case x in $PATTERN) : >unexpected;; esac', {
        env: { PATTERN: pattern }, signal: controller.signal,
      });
      outcome = { result, files: await fs.readdir("/") };
    } finally { await shell.dispose(); }
  }
} catch (error) {
  if (error !== reason) throw error;
  outcome = "cancelled";
} finally { clearTimeout(timer); }
console.log(JSON.stringify({ length: request.length, mode: request.mode, elapsedMs: performance.now() - started, aborted: controller.signal.aborted, outcome }));
