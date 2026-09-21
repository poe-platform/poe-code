import { spawn } from "node:child_process";
import { constants } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { native } from "./native.js";
const [graceMs, pollMs, groupWaitMs] = native.spawnCommandTimings();
export function runCommand(command, args, input) {
  return new Promise((resolve) => {
    const options = Object.create(null);
    if (input !== undefined)
      for (const name of ["cwd", "env", "stdin", "timeoutMs", "signal"])
        if (Object.hasOwn(input, name)) {
          const value = input[name];
          if (value !== undefined) options[name] = value;
        }
    const state = new native.NativeSpawnCommand(
        process.platform !== "win32",
        options.signal !== undefined,
        options.timeoutMs,
        options.signal?.aborted === true
      ),
      before = state.preaborted();
    if (before !== null) {
      resolve(before);
      return;
    }
    const hasStdin = options.stdin != null,
      child = spawn(
        command,
        args,
        Object.assign(Object.create(null), {
          stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"],
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : undefined,
          ...(state.group ? { detached: true } : {})
        })
      );
    if (state.group) child.unref();
    let timer,
      escalation,
      settled = false;
    const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(escalation);
        options.signal?.removeEventListener("abort", abort);
      },
      finish = (value) => {
        if (value !== null) {
          settled = true;
          cleanup();
          resolve(value);
        }
      },
      kill = (signal) => {
        if (state.group && typeof child.pid === "number" && child.pid > 0) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {}
        }
        child.kill(signal);
      },
      terminate = (timeout) => {
        if (state.terminate(timeout)) {
          kill("SIGTERM");
          escalation = setTimeout(() => kill("SIGKILL"), graceMs);
        }
      },
      abort = () => terminate(false);
    if (typeof options.timeoutMs === "number" && options.timeoutMs > 0)
      timer = setTimeout(() => terminate(true), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (hasStdin && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => state.stdout(chunk.toString()));
    child.stderr?.on("data", (chunk) => state.stderr(chunk.toString()));
    child.on("error", (error) => {
      const code =
        Object.hasOwn(error, "code") && typeof error.code === "number" ? error.code : undefined;
      finish(
        state.error(
          error instanceof Error ? error.message : String(error ?? "error"),
          code,
          typeof error.errno === "number" ? error.errno : undefined
        )
      );
    });
    child.on("close", (code, signal) => {
      void (async () => {
        if (settled) return;
        if (state.terminated && state.group && typeof child.pid === "number") {
          const deadline = Date.now() + groupWaitMs;
          while (Date.now() < deadline) {
            try {
              process.kill(-child.pid, 0);
            } catch (error) {
              if (error instanceof Error && Object.hasOwn(error, "code") && error.code === "ESRCH")
                break;
            }
            await delay(pollMs);
          }
        }
        finish(state.close(code, signal ? constants.signals[signal] : undefined));
      })();
    });
  });
}
