import { build } from "esbuild";
import { expect, it } from "vitest";

it("defines and executes commands without Node compatibility", async () => {
  const bundle = await build({ stdin: { contents: 'export { defineCommand, S } from "toolcraft/runtime";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "commands", logLevel: "silent" });
  const { defineCommand, S } = new Function(`${bundle.outputFiles[0].text}; return commands;`)();
  const command = defineCommand({ name: "hello", params: S.Object({ name: S.String() }), handler: async ({ params }: { params: { name: string } }) => `Hello ${params.name}` });
  expect(command.name).toBe("hello");
  expect(await command.handler({ params: { name: "Worker" } })).toBe("Hello Worker");
});
