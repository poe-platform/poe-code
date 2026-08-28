import { spawn } from "node:child_process";

export async function runBoundedChild(executable, args, options) {
  const { cwd, env, timeoutMs = 30000, maxCaptureBytes = 1024 * 1024, spawnChild = spawn } = options;
  return await new Promise((resolve, reject) => {
    const child = spawnChild(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const output = { stdout: [], stderr: [] };
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let escalation;
    let spawnError;
    const terminate = () => { child.kill("SIGTERM"); escalation ??= setTimeout(() => child.kill("SIGKILL"), 500); };
    const watchdog = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    for (const channel of ["stdout", "stderr"]) child[channel].on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxCaptureBytes) { overflow = true; terminate(); }
      else output[channel].push(Buffer.from(chunk));
    });
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, signal) => {
      clearTimeout(watchdog);
      if (escalation) clearTimeout(escalation);
      const result = { code, signal, closed: true, natural: !timedOut && !overflow && signal === null && !spawnError, timedOut, overflow, leak: timedOut || overflow, stdout: Buffer.concat(output.stdout).toString("utf8"), stderr: Buffer.concat(output.stderr).toString("utf8") };
      if (spawnError) reject(Object.assign(new Error("child spawn failed", { cause: spawnError }), { result }));
      else resolve(result);
    });
  });
}
