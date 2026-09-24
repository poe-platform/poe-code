import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";

/** Keep the real main-thread stack, but pay the TypeScript/module startup once per suite. */
export function mainThreadFixture(fixture: URL): (request: unknown) => Promise<string> {
  let child: ChildProcess;
  let pending: { resolve(value: string): void; reject(error: Error): void } | undefined;
  let stderr = "";
  beforeAll(async () => {
    child = fork(fileURLToPath(new URL("./main-thread-host.ts", import.meta.url)), [fixture.href], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    child.stderr!.on("data", bytes => { stderr = (stderr + String(bytes)).slice(-8192); });
    child.on("error", error => { pending?.reject(error); });
    child.on("exit", (code, signal) => {
      pending?.reject(new Error(`Main-thread fixture exited (${code ?? signal}): ${stderr}`));
    });
    child.on("message", (message: { value?: string; error?: string }) => {
      if (message.error !== undefined) pending?.reject(new Error(message.error));
      else pending?.resolve(message.value ?? "");
    });
    await new Promise<string>((resolve, reject) => { pending = { resolve, reject }; });
    pending = undefined;
  });
  afterAll(async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 500);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  });
  return async request => {
    if (!child.connected) throw new Error("Main-thread fixture is unavailable");
    if (pending) throw new Error("Main-thread fixture requests must be sequential");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Main-thread fixture exceeded the four-second request budget"));
        }, 4000);
        child.send(JSON.stringify(request) ?? "null", error => { if (error) reject(error); });
      });
    } finally { clearTimeout(timer); pending = undefined; }
  };
}
