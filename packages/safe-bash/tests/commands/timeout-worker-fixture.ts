import type { VirtualShellPlugin } from "../../src/contracts/index.js";
import { parentPort } from "node:worker_threads";

export function cancelledOpenCommands(): VirtualShellPlugin {
  return { name: "worker-cancelled-open-test", setup(host) {
    host.commands.register({ name: "cancelled-open-child", async execute(context) {
      if (!parentPort) throw new Error("This command requires its declared worker module");
      const controller = new AbortController(), reason = new Error("Cancel delivered open reply");
      const post = parentPort.postMessage.bind(parentPort);
      let openRequest: number | undefined, closes = 0;
      parentPort.postMessage = message => {
        if (message.kind === "call" && message.operation === "readStream.open") openRequest = message.id;
        if (message.kind === "call" && message.operation === "readStream.close") closes++;
        post(message);
      };
      const cancelReply = (message: { kind: string; id?: number }) => {
        if (message.kind === "reply" && message.id === openRequest) controller.abort(reason);
      };
      parentPort.on("message", cancelReply);
      try {
        const reader = context.fs.readStream!("/file", { signal: controller.signal })[Symbol.asyncIterator]();
        try { await reader.next(); throw new Error("Cancelled open unexpectedly succeeded"); }
        catch (error) { if (error !== reason) throw error; }
        await context.stdout.write(new TextEncoder().encode(JSON.stringify({ closes })));
        return { exitCode: 9 };
      } finally {
        parentPort.removeListener("message", cancelReply);
        parentPort.postMessage = post;
      }
    } });
  } };
}

export function workerCommands(): VirtualShellPlugin {
  return { name: "worker-test", setup(host) {
    host.commands.register({ name: "busy-child", async execute(context) {
      await context.stdout.write(new TextEncoder().encode("started"));
      // This loop deliberately cannot observe a cancellation message.
      for (;;) { /* retired by terminating its worker */ }
    } });
  } };
}

export function collisionCommands(): VirtualShellPlugin {
  return { name: "worker-collision-test", setup(host) {
    for (const name of ["__timeout_worker_entry", "__timeout_worker_entry-"]) {
      host.commands.register({ name, async execute(context) {
        await context.stdout.write(new TextEncoder().encode(name));
        return { exitCode: 9 };
      } });
    }
  } };
}

export function omittedOptionsCommands(): VirtualShellPlugin {
  return { name: "worker-omitted-options-test", setup(host) {
    host.commands.register({ name: "optional-position-child", async execute(context) {
      await context.fs.access("/file");
      await context.fs.access("/file", undefined);
      await context.fs.access("/file", 4, undefined);
      await context.fs.truncate!("/file");
      await context.fs.truncate!("/file", undefined);
      await context.fs.truncate!("/file", 0, undefined);
      return { exitCode: 9 };
    } });
    host.commands.register({ name: "omitted-options-child", async execute(context) {
      const bytes = await context.fs.readFile("/file", undefined);
      await context.stdout.write(bytes);
      return { exitCode: 9 };
    } });
  } };
}
