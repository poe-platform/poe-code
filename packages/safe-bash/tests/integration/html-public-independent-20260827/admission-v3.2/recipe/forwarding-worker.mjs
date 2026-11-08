import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { json } from "./telemetry.mjs";

const [mode, output] = process.argv.slice(2);
const baseline = process.memoryUsage();
if (mode === "binding-change") writeFileSync(join(output, "binding.data"), "changed\n");
if (mode === "marker") json(join(output, "MARKER.json"), { pid: process.pid, at: new Date().toISOString() });
if (mode !== "missing-receipt") json(join(output, "child.receipt.json"), {
  pid: process.pid, ppid: process.ppid, mode, reason: mode === "wrong-reason" ? "WRONG_REASON" : "EXACT_FORWARDING_REASON",
  memory: { baseline, fieldwisePeaks: process.memoryUsage() },
});
if (mode === "ignore-term") {
  process.on("SIGTERM", () => {});
  process.send({ type: "ready" });
  setInterval(() => {}, 1000);
} else {
  process.exitCode = mode === "semantic-failure" ? 17 : 0;
  process.disconnect();
}
