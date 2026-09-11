import { Shell, browserCommands, browserLimits } from "./engine/index.js";
import { browserWorkerRuntime } from "./engine/workers.mjs";
import { decodeError, remoteFileSystem } from "./execution-filesystem.js";
import type { ExecutionMessage, PageMessage } from "./execution-protocol.js";

const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const auxiliary = new Map<number, EventTarget>();
let nextIdentity = 0;
let started = false;
const send = (message: ExecutionMessage): void => globalThis.postMessage(message);

browserWorkerRuntime.create = (worker, data) => {
  if (auxiliary.size >= 4) throw new Error("Auxiliary worker limit exceeded");
  const identity = ++nextIdentity;
  const target = new EventTarget();
  auxiliary.set(identity, target);
  send({ kind: "aux-create", identity, worker, data });
  return {
    worker: Object.assign(target, {
      postMessage(value: unknown) {
        send({ kind: "aux-message", identity, value });
      }
    }),
    close() {
      auxiliary.delete(identity);
      send({ kind: "aux-close", identity });
    }
  };
};

globalThis.addEventListener("message", async (event: MessageEvent<PageMessage>) => {
  const message = event.data;
  if (message.kind === "fs-result") {
    const operation = pending.get(message.identity);
    pending.delete(message.identity);
    if (message.error) operation?.reject(decodeError(message.error));
    else operation?.resolve(message.value);
  } else if (message.kind === "aux-event") {
    const target = auxiliary.get(message.identity);
    if (message.event === "error") {
      target?.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message: String(message.value) }));
    } else {
      target?.dispatchEvent(new MessageEvent(message.event, { data: message.value }));
    }
  } else if (message.kind === "start" && !started) {
    started = true;
    const fs = remoteFileSystem(message.filesystem, (method, args) => {
      if (pending.size >= 64) return Promise.reject(new Error("Filesystem request limit exceeded"));
      return new Promise((resolve, reject) => {
        const identity = ++nextIdentity;
        pending.set(identity, { resolve, reject });
        try {
          send({ kind: "fs", identity, method, args });
        } catch (error) {
          pending.delete(identity);
          reject(error);
        }
      });
    });
    const shell = new Shell({ fs, cwd: message.cwd, env: { HOME: "/home" }, limits: browserLimits }).use(browserCommands());
    shell.register({
      name: "help",
      description: "Show playground commands, examples, and resource limits",
      async execute(context) {
        await context.stdout.write(new TextEncoder().encode(message.help));
        return { exitCode: 0 };
      }
    });
    let result;
    try {
      const executed = await shell.exec(message.command, {
        cwd: message.cwd,
        onCwd: (cwd) => send({ kind: "state", cwd }),
        onState: ({ cwd }) => send({ kind: "state", cwd })
      });
      result = { stdout: executed.stdout, stderr: executed.stderr, exitCode: executed.exitCode };
    } catch (error) {
      result = { stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n`, exitCode: 1 };
    } finally {
      await shell.dispose();
    }
    send({ kind: "result", result });
  }
});
send({ kind: "ready" });
