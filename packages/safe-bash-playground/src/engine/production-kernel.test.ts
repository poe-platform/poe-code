import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { safeBashBrowserPlugin } from "./build-plugin.mjs";

it("shares the emitted production kernel with the worker runtime adapter", () => {
  const plugin = safeBashBrowserPlugin();
  plugin.configResolved({ command: "build" });
  const kernel = plugin.resolveId("virtual:safe-bash-kernel");
  expect(kernel).toEqual({ id: "./safe-bash-kernel.js", external: true });
  expect(plugin.resolveId("./engine/workers.mjs", fileURLToPath(new URL("../execution.ts", import.meta.url)))).toEqual(kernel);
});
