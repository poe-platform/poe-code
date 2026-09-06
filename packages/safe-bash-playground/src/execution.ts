import type { FileSystem } from "./engine/index.js";
import { browserWorkerRuntime } from "./engine/workers.mjs";
import type { BrowserWorkerResource } from "./engine/workers.mjs";
import { encodeError, hostFileSystem } from "./execution-filesystem.js";
import type { ExecutionMessage, PageMessage } from "./execution-protocol.js";
import type { RunResult } from "./session.js";

export function executeInWorker(
  fs: FileSystem,
  command: string,
  cwd: string,
  help: string,
  onState: (cwd: string) => void
): Promise<RunResult> {
  if (new TextEncoder().encode(command).length > 16 * 1024) {
    return Promise.resolve({ stdout: "", stderr: "Shell source exceeds 16 KiB\n", exitCode: 1 });
  }
  return new Promise((resolve) => {
    const controller = new AbortController();
    const filesystem = hostFileSystem(fs, controller.signal);
    const auxiliary = new Map<number, BrowserWorkerResource>();
    let worker: Worker | undefined;
    let finished = false;
    let started = false;
    const timeout = setTimeout(() => finish({ stdout: "", stderr: "Shell worker exceeded the 5-second deadline\n", exitCode: 124 }), 5000);
    async function finish(result: RunResult): Promise<void> {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      controller.abort();
      worker?.terminate();
      for (const resource of auxiliary.values()) resource.close();
      auxiliary.clear();
      await filesystem.close();
      resolve(result);
    }
    const fail = (error: unknown): void => {
      void finish({ stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n`, exitCode: 1 });
    };
    const send = (message: PageMessage): void => {
      if (!finished) worker?.postMessage(message);
    };
    const receive = async (event: MessageEvent<ExecutionMessage>): Promise<void> => {
      if (finished) return;
      const message = event.data;
      try {
        if (message.kind === "ready") {
          if (started) throw new Error("Duplicate worker startup");
          started = true;
          send({ kind: "start", command, cwd, help, filesystem: filesystem.description });
        } else if (!started) {
          throw new Error("Worker message before startup");
        } else if (message.kind === "result") {
          if (!message.result || typeof message.result.stdout !== "string" ||
              typeof message.result.stderr !== "string" || !Number.isInteger(message.result.exitCode)) {
            throw new Error("Invalid worker result");
          }
          await finish(message.result);
        } else if (message.kind === "state") {
          onState(message.cwd);
        } else if (message.kind === "fs") {
          try {
            const value = await filesystem.dispatch(message.method, message.args);
            send({ kind: "fs-result", identity: message.identity, value });
          } catch (error) {
            send({ kind: "fs-result", identity: message.identity, error: encodeError(error) });
          }
        } else if (message.kind === "aux-create") {
          if (auxiliary.size >= 4 || auxiliary.has(message.identity)) throw new Error("Auxiliary worker limit exceeded");
          const resource = browserWorkerRuntime.create(message.worker, message.data);
          auxiliary.set(message.identity, resource);
          resource.worker.addEventListener("message", (event) => send({ kind: "aux-event", identity: message.identity, event: "message", value: event.data }));
          resource.worker.addEventListener("messageerror", () => send({ kind: "aux-event", identity: message.identity, event: "messageerror", value: undefined }));
          resource.worker.addEventListener("error", (event) => {
            event.preventDefault();
            send({ kind: "aux-event", identity: message.identity, event: "error", value: event.message });
            resource.close();
            auxiliary.delete(message.identity);
          });
        } else if (message.kind === "aux-message") {
          auxiliary.get(message.identity)?.worker.postMessage(message.value);
        } else if (message.kind === "aux-close") {
          auxiliary.get(message.identity)?.close();
          auxiliary.delete(message.identity);
        } else {
          throw new Error("Unknown execution worker message");
        }
      } catch (error) {
        fail(error);
      }
    };
    try {
      worker = new Worker(new URL("./execution-worker.ts", import.meta.url), { type: "module", name: "safe-bash-execution" });
      worker.addEventListener("message", (event) => { void receive(event); });
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        fail(new Error(event.message || "Execution worker failed"));
      });
      worker.addEventListener("messageerror", () => fail(new Error("Execution worker message could not be decoded")));
    } catch (error) {
      fail(error);
    }
  });
}
