import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { matchesPattern } from "../../../src/shell/pattern.js";
import { runtime } from "../probes.js";

const request = JSON.parse(readFileSync(0, "utf8")) as { length: number; mode: "matcher" | "shell" };
if (!Number.isSafeInteger(request.length) || request.length < 1 || request.length > 65536) throw new Error("Invalid bounded pattern length");
const pattern = "[".repeat(request.length);
const controller = new AbortController();
const reason = new Error("independent case-pattern cancellation");
const timer = setTimeout(() => controller.abort(reason), 10);
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
    const { shell, fs } = runtime();
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
