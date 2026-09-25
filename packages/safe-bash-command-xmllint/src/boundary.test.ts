import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";
import type { XmlCommandRuntime } from "safe-bash-xml-engine/io";

const encoder = new TextEncoder();
const runtime: XmlCommandRuntime = {
  yieldTurn: async (signal) => {
    signal.throwIfAborted();
  },
  pathOf: (context, path) => (path.startsWith("/") ? path : `${context.cwd}/${path}`),
  interruptible: async (operation, signal) => {
    signal.throwIfAborted();
    return operation();
  },
  writeDiagnostic: async (sink, text, signal) => {
    signal?.throwIfAborted();
    await sink.write(encoder.encode(text));
  }
};

for (const [args, input, output, exitCode] of [
  [["--xpath", "count(/root/item)"], "<root><item/><item/></root>", "2\n", 0],
  [["--noout"], "<root/>", "", 0],
  [["--c14n"], '<root b="2" a="1"/>', '<root a="1" b="2"></root>', 0],
  [["--xpath", "/root/missing"], "<root/>", "", 11],
  [["--noout"], "<root>", "", 1]
] as const)
  test(`private command executes ${args.join(" ")} with canonical argv`, async () => {
    const stdout: Uint8Array[] = [],
      stderr: Uint8Array[] = [];
    const context: CommandContext = {
      command: "xmllint",
      ...createCommandArguments(args),
      cwd: "/",
      env: {},
      signal: new AbortController().signal,
      fs: {} as CommandContext["fs"],
      stdin: toByteSource(input),
      stdout: {
        async write(bytes) {
          stdout.push(bytes.slice());
        }
      },
      stderr: {
        async write(bytes) {
          stderr.push(bytes.slice());
        }
      }
    };
    const result = await createXmllintCommand({}, runtime).execute(context);
    assert.equal(result.exitCode, exitCode);
    assert.equal(stdout.map((b) => new TextDecoder().decode(b)).join(""), output);
    if (exitCode) assert.ok(stderr.length);
  });

test("private command retains explicit output limits", async () => {
  const context: CommandContext = {
    command: "xmllint",
    ...createCommandArguments(["--c14n"]),
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    fs: {} as CommandContext["fs"],
    stdin: toByteSource("<root/>"),
    stdout: {
      async write() {
        assert.fail("output must be admitted before writing");
      }
    },
    stderr: { async write() {} }
  };
  assert.equal(
    (await createXmllintCommand({ limits: { maxOutputBytes: 1 } }, runtime).execute(context))
      .exitCode,
    5
  );
});
