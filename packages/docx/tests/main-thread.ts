import { spawn, type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";

/** Keep the real main-thread stack without a runtime TypeScript loader. */
export function mainThreadFixture(fixture: URL): (request: unknown) => Promise<string> {
  let child: ChildProcess;
  let pending: { resolve(value: string): void; reject(error: Error): void } | undefined;
  let stderr = "";
  beforeAll(async () => {
    const directory = fileURLToPath(new URL(".", fixture));
    const { outputFiles } = await build({
      stdin: {
        contents: `import { run } from ${JSON.stringify(fileURLToPath(fixture))};
import { serveFixture } from ${JSON.stringify(fileURLToPath(new URL("./main-thread-host.ts", import.meta.url)))};
serveFixture(run);`,
        resolveDir: directory,
        sourcefile: "main-thread-fixture.ts"
      },
      bundle: true, write: false, platform: "node", format: "esm", target: "node22",
      packages: "external", sourcemap: "inline", sourcesContent: false
    });
    child = spawn(process.execPath, ["--input-type=module", "--enable-source-maps", "-"], {
      cwd: directory, stdio: ["pipe", "ignore", "pipe", "ipc"]
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
    const ready = new Promise<string>((resolve, reject) => { pending = { resolve, reject }; });
    child.stdin!.on("error", error => { pending?.reject(error); });
    child.stdin!.end(outputFiles[0]!.contents);
    await ready;
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
          reject(new Error("Main-thread fixture exceeded the twenty-five-second request budget"));
        }, 25000);
        child.send(JSON.stringify(request) ?? "null", error => { if (error) reject(error); });
      });
    } finally { clearTimeout(timer); pending = undefined; }
  };
}
