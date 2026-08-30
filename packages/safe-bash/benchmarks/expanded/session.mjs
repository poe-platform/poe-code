import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function session(engine, sourceRoot, baselineRoot) {
  const child = fork(fileURLToPath(new URL("engine.mjs", import.meta.url)), [], {
    execArgv: ["--expose-gc", "--unhandled-rejections=strict", "--import", "tsx", "--max-old-space-size=256"],
    env: { ...process.env, EXPANDED_ENGINE: engine, EXPANDED_SOURCE_ROOT: sourceRoot, EXPANDED_BASELINE_ROOT: baselineRoot },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let messages = "", nextId = 0, pending;
  const capture = bytes => { if (messages.length < 65536) messages += bytes.toString(); };
  child.stdout.on("data", capture); child.stderr.on("data", capture);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Engine startup deadline")); }, 15000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); reject(new Error(`Engine startup exit ${code}/${signal}: ${messages}`)); });
    child.once("message", message => { clearTimeout(timer); if (message.ready) resolve(); else { child.kill(); reject(new Error(message.error)); } });
  });
  child.on("message", message => { if (pending?.id === message.id) { clearTimeout(pending.timer); const active = pending; pending = undefined; active.resolve(message); } });
  child.on("exit", (code, signal) => { if (pending) { clearTimeout(pending.timer); pending.resolve({ error: `Engine exited ${code}/${signal}: ${messages}` }); pending = undefined; } });
  return {
    async run(specimen, baseUrl, instrument = true, warmup = 0) {
      if (pending) throw new Error("Engine calls must be serial");
      return new Promise(resolve => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending = undefined; child.kill("SIGKILL"); resolve({ timeout: true, error: `Engine deadline: ${messages}` }); }, 10000);
        pending = { id, timer, resolve };
        child.send({ id, specimen, baseUrl, instrument, warmup }, error => { if (error && pending?.id === id) { clearTimeout(timer); pending = undefined; resolve({ error: error.message }); } });
      });
    },
    get logs() { return messages; },
    async close() { if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM"); await exited; } },
  };
}
