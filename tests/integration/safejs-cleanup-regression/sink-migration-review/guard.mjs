import { readFileSync } from "node:fs";
import { register, registerHooks } from "node:module";
import { isMainThread, MessageChannel } from "node:worker_threads";
import { check, verify } from "./audit.mjs";

verify(import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    check(result.url);
    return result;
  },
  load(url, context, next) {
    const entry = verify(url);
    if (entry && (context.format === "commonjs" || entry.local.endsWith(".cjs") || entry.local === "node_modules/esbuild/lib/main.js")) {
      return { format: "commonjs", source: readFileSync(entry.filename), shortCircuit: true };
    }
    return next(url, context);
  },
});

if (isMainThread) {
  const { port1, port2 } = new MessageChannel();
  register(new URL("./loader.mjs", import.meta.url), { data: { port: port2 }, transferList: [port2] });
  port1.unref();
  globalThis[Symbol.for("owned-cleanup-loader-stop")] = () => new Promise((resolve, reject) => {
    port1.ref();
    port1.once("message", message => {
      port1.close();
      if (message.error) reject(new Error(message.error)); else resolve(message);
    });
    port1.postMessage("stop-owned-loader");
  });
}
