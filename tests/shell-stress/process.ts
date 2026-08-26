import { spawn } from "node:child_process";

export interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string | Uint8Array;
  readonly timeout: number;
  readonly maxBuffer: number;
}

export interface ProcessOutcome {
  readonly pid: number | undefined;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: Error | undefined;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export function isolatedSpawn(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessOutcome> {
  if (process.platform === "win32") throw new Error("Shell stress isolation requires POSIX process groups");
  if (!Number.isSafeInteger(options.timeout) || options.timeout < 1) throw new RangeError("Invalid child timeout");
  if (!Number.isSafeInteger(options.maxBuffer) || options.maxBuffer < 1) throw new RangeError("Invalid child output limit");
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, shell: false, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let captured = 0;
    let failure: Error | undefined;
    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
          failure ??= error instanceof Error ? error : new Error(String(error));
          child.kill("SIGKILL");
        }
      }
    };
    const stop = (error: Error) => {
      failure ??= error;
      killGroup();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const timer = setTimeout(() => stop(Object.assign(new Error(`Child exceeded ${options.timeout} ms hard deadline`), { code: "ETIMEDOUT" })), options.timeout);
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      if (failure) return;
      const available = options.maxBuffer - captured;
      const kept = chunk.subarray(0, available);
      if (kept.length) chunks.push(Buffer.from(kept));
      captured += kept.length;
      if (chunk.length > available) stop(Object.assign(new Error(`Child exceeded ${options.maxBuffer} byte output ceiling`), { code: "ENOBUFS" }));
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.stdout.on("error", stop);
    child.stderr.on("error", stop);
    child.stdin.on("error", error => {
      if (!("code" in error && error.code === "EPIPE")) stop(error);
    });
    child.on("error", error => { failure ??= error; });
    child.once("exit", killGroup);
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      killGroup();
      resolve({ pid: child.pid, status, signal, error: failure, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    child.stdin.end(options.input);
  });
}
