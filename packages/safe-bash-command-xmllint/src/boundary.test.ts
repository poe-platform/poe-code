import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXqCommand } from "safe-bash-command-xq";
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
  [["--format", "--xpath", "//a", "-"], "<root><a>1</a><a>2</a></root>", "<a>1</a>\n<a>2</a>\n", 0],
  [["--xpath", "//a", "--format", "-"], "<root><a>1</a></root>", "<a>1</a>\n", 0],
  [["--noout", "--format", "--xpath", "--", "//a", "--", "-"], "<root><a/></root>", "<a/>\n", 0],
  [["--format", "--format", "--noout", "--noout", "--", "-", "extra"], "<root/>", "", 2],
  [["--xpath", "/root/@xml:lang"], '<root xml:lang="en"/>', ' xml:lang="en"\n', 0],
  [["--xpath", '//*[local-name()="item"]'], '<root xmlns:ns="urn:x"><ns:item>val</ns:item></root>', '<ns:item>val</ns:item>\n', 0],
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

for (const create of [createXmllintCommand, createXqCommand]) {
  for (const file of [false, true]) {
    test(`XML command ${create.name} enforces shell input limits on ${file ? "file" : "stdin"}`, async () => {
      let checked = false;
      const command = create({}, runtime);
      const context = {
        command: command.name,
        ...createCommandArguments([...(command.name === "xq" ? ["."] : []), ...(file ? ["/input.xml"] : [])]),
        cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: toByteSource("<root/>"),
        fs: {
          capabilities: { streamingRead: true },
          readStream: () => toByteSource("<root/>")
        },
        inputBudget: {
          maxBytes: 6,
          check(total: number) {
            checked = true;
            assert.equal(total, 7);
            throw new Error("host input limit");
          }
        },
        stdout: { async write() { assert.fail("over-budget XML emitted output"); } },
        stderr: { async write() {} }
      } as unknown as CommandContext;
      // Commands may propagate host failures or translate them to a nonzero result.
      try {
        assert.notEqual((await command.execute(context)).exitCode, 0);
      } catch (error) {
        assert.equal((error as Error).message, "host input limit");
      }
      assert.equal(checked, true);
    });
  }
}
