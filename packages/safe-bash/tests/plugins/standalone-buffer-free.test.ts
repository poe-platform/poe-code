import assert from "node:assert/strict";
import test from "node:test";
import type { CommandDefinition } from "../../src/contracts/index.js";
import type { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("standalone command families execute all twenty text and archive commands without Buffer", async () => {
  const { api } = await portableRuntime(`
    import { createStandardCommands } from "./packages/safe-bash/src/commands/index.ts";
    import { createSearchCommands } from "./packages/safe-bash/src/commands/search/index.ts";
    import { createStructuredCommands } from "./packages/safe-bash/src/commands/structured/index.ts";
    import { createDiffPatchCommands } from "./packages/safe-bash/src/commands/diff-patch/index.ts";
    import { createArchiveCommands } from "./packages/safe-bash/src/commands/archive/index.ts";
    import { createTableTextCommands } from "./packages/safe-bash/src/commands/table-text/index.ts";
    import { createStreamInspectionCommands } from "./packages/safe-bash/src/commands/stream-inspection/index.ts";
    import { createStreamFormatCommands } from "./packages/safe-bash/src/commands/stream-format/index.ts";
    import { createTimeEnvCommands } from "./packages/safe-bash/src/commands/time-env/index.ts";
    import { createTreeCommands } from "./packages/safe-bash/src/commands/tree/index.ts";
    import { createFileCommands } from "./packages/safe-bash/src/commands/file/index.ts";
    import { createColumnCommands } from "./packages/safe-bash/src/commands/column/index.ts";
    import { createMetadataCommands } from "./packages/safe-bash/src/commands/metadata/index.ts";
    export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    export function createCommands() {
      Reflect.deleteProperty(globalThis, "Buffer");
      return [createStandardCommands, createSearchCommands, createStructuredCommands,
        createDiffPatchCommands, createArchiveCommands, createTableTextCommands,
        createStreamInspectionCommands, createStreamFormatCommands, createTimeEnvCommands,
        createTreeCommands, createFileCommands, createColumnCommands, createMetadataCommands
      ].flatMap(factory => factory());
    }
    export function hasBuffer() { return typeof globalThis.Buffer !== "undefined"; }
  `);
  const standalone = api as unknown as {
    MemoryFileSystem: typeof MemoryFileSystem;
    createCommands(): readonly CommandDefinition[];
    hasBuffer(): boolean;
  };
  const commands = new Map(standalone.createCommands().map(command => [command.name, command]));
  const fs = new standalone.MemoryFileSystem();
  await fs.writeFile("/a", new TextEncoder().encode("hello\nworld\n"));
  await fs.writeFile("/data.json", new TextEncoder().encode('{"a":1}\n'));
  const cases: readonly [string, readonly string[], string | undefined][] = [
    ["uniq", ["/a"], "hello\nworld\n"], ["rg", ["hello", "/a"], "hello\n"],
    ["jq", [".a", "/data.json"], "1\n"], ["diff", ["/a", "/a"], ""],
    ["comm", ["/a", "/a"], "\t\thello\n\t\tworld\n"], ["join", ["/a", "/a"], "hello\nworld\n"],
    ["paste", ["/a", "/a"], "hello\thello\nworld\tworld\n"], ["column", ["-t", "/a"], "hello\nworld\n"],
    ["expand", ["/a"], "hello\nworld\n"], ["fold", ["-w", "3", "/a"], "hel\nlo\nwor\nld\n"],
    ["nl", ["/a"], "     1\thello\n     2\tworld\n"], ["tac", ["/a"], "world\nhello\n"],
    ["strings", ["/a"], "hello\nworld\n"], ["seq", ["1", "3"], "1\n2\n3\n"],
    ["tar", ["-cf", "/a.tar", "a"], ""], ["zip", ["-q", "/a.zip", "a"], ""],
    ["file", ["/a"], undefined], ["stat", ["-c", "%s", "/a"], "12\n"],
    ["tree", ["/"], undefined], ["date", ["-u", "-d", "2020-01-01", "+%Y"], "2020\n"],
    // Read back both archives to exercise binary decoding as well as creation.
    ["tar", ["-xOf", "/a.tar", "a"], "hello\nworld\n"],
    ["unzip", ["-p", "/a.zip", "a"], "hello\nworld\n"],
  ];
  for (const [name, args, expected] of cases) {
    let stdout = "", stderr = "";
    const result = await commands.get(name)!.execute({
      command: name, args: [...args], cwd: "/", env: {}, fs,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, `${name}: ${stderr}`);
    assert.equal(stderr, "", name);
    if (expected !== undefined) assert.equal(stdout, expected, name);
    else assert.ok(stdout.includes(name === "file" ? "ASCII text" : "a.tar"), `${name}: ${stdout}`);
    assert.equal(standalone.hasBuffer(), false, name);
  }
});
