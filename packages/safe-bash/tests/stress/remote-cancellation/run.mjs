import { spawn } from "node:child_process";
import { formatAuditOutput } from "./format.mjs";

const repetitions = Number(process.env.AUDIT_REPEATS ?? 1);
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error("AUDIT_REPEATS must be 1..10");
let failed = false;
for (let repetition = 1; repetition <= repetitions; repetition++) {
  const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap",
    ...(process.env.AUDIT_CASE ? [`--test-name-pattern=${process.env.AUDIT_CASE}`] : []),
    "tests/stress/remote-cancellation/remote-cancellation.test.ts"], { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let output = "";
  const stop = () => {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const interrupted = () => { stop(); process.exitCode = 1; };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  const timer = setTimeout(() => { failed = true; console.error("OUTER WATCHDOG: 60s; killing audit process group"); stop(); }, 60_000);
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  clearTimeout(timer);
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, 0);
      console.error("RESIDUAL PROCESS GROUP: forcibly stopped after audit child exit");
      failed = true;
      stop();
    } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  console.log(`REPLAY ${repetition}: exit=${code}`);
  if (process.env.AUDIT_VERBOSE) console.log(output.trim());
  else {
    const formatted = formatAuditOutput(output);
    console.log(formatted.lines.join("\n"));
    for (const error of formatted.errors) console.error(error);
    if (formatted.errors.length) failed = true;
  }
  if (code !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
