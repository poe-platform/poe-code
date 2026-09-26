import assert from "node:assert/strict";
import test from "node:test";
import { createXmllintCommand } from "./index.js";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";

test("xmllint accepts omitted options and runtime", () => {
  assert.equal(createXmllintCommand().name, "xmllint");
});

test("portable runtime cancels a pending VFS read", { timeout: 200 }, async () => {
  const controller = new AbortController();
  const failure = new Error("cancelled read");
  const context: CommandContext = {
    command: "xmllint", ...createCommandArguments(["--noout", "/input.xml"]), cwd: "/", env: {},
    signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    fs: { capabilities: {}, async readFile() { controller.abort(failure); return new Promise<Uint8Array>(() => {}); } } as unknown as CommandContext["fs"]
  };
  await assert.rejects(Promise.resolve(createXmllintCommand().execute(context)), failure);
});
