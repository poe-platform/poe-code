import assert from "node:assert/strict";
import {
  agentCommands, CommandRegistry, createAgentCommands, createMemoryFileSystem,
  createStreamInspectionCommands, Shell, streamInspectionCommands,
  type AgentCommandsOptions, type CommandDefinition, type VirtualShellPlugin,
  type StreamInspectionCommandsOptions, type StreamInspectionLimits,
} from "virtual-bash";
import {
  createStreamInspectionCommands as subpathFactory,
  streamInspectionCommands as subpathPlugin,
  type StreamInspectionCommandsOptions as SubpathOptions,
  type StreamInspectionLimits as SubpathLimits,
} from "virtual-bash/commands/stream-inspection";

const limits: StreamInspectionLimits = {
  maxInputBytes: 1024, maxOutputBytes: 4096, maxRecordBytes: 1024,
  maxChunkBytes: 1024, maxFiles: 4, maxSteps: 8192, maxArgumentBytes: 1024,
};
const subpathLimits: SubpathLimits = limits;
const options: StreamInspectionCommandsOptions = { limits: subpathLimits };
const subpathOptions: SubpathOptions = options;
const aggregateOptions: AgentCommandsOptions = { streamInspection: subpathOptions };
const replacementIsTopLevel: "replace" extends keyof NonNullable<AgentCommandsOptions["streamInspection"]> ? false : true = true;
const definitions: readonly CommandDefinition[] = subpathFactory(options);
const plugin: VirtualShellPlugin = subpathPlugin(options);
assert.equal(replacementIsTopLevel, true);
assert.equal(createStreamInspectionCommands, subpathFactory);
assert.equal(streamInspectionCommands, subpathPlugin);
assert.deepEqual(definitions.map(command => command.name), ["tac", "expand", "fold", "strings"]);
assert.deepEqual(Object.keys(await import("virtual-bash/commands/stream-inspection")).sort(), ["createStreamInspectionCommands", "streamInspectionCommands"]);
const rootResolution = import.meta.resolve("virtual-bash");
const subpathResolution = import.meta.resolve("virtual-bash/commands/stream-inspection");
assert.ok(rootResolution.includes("/consumer/node_modules/virtual-bash/dist/index.js"), rootResolution);
assert.ok(subpathResolution.includes("/consumer/node_modules/virtual-bash/dist/commands/stream-inspection/index.js"), subpathResolution);

const names = createAgentCommands(aggregateOptions).map(command => command.name);
const expectedNames = [
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch", "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath",
  "ls", "cat", "head", "tail", "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find", "sed", "awk", "jq", "rg",
  "base64", "base32", "xxd", "od", "sha256sum", "sha1sum", "md5sum", "cksum", "gzip", "gunzip", "zcat", "diff", "patch", "chmod", "stat", "mktemp", "tar",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split", "date", "sleep", "printenv", "tree", "file",
  "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "git",
];
assert.deepEqual(names, expectedNames);
assert.equal(names.length, expectedNames.length);
assert.equal(new Set(names).size, expectedNames.length);
assert.equal(names.at(75), "expr");
assert.deepEqual(names.slice(56, 60), ["tac", "expand", "fold", "strings"]);
assert.deepEqual(names.slice(60, 76), ["seq", "nl", "rev", "unexpand", "split", "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr"]);
assert.equal(names.includes("curl"), false);
assert.equal(names.includes("safejs"), false);
const results: { mode: string; command: string; stdoutHex: string }[] = [];
for (const mode of ["plugin", "factory", "standalone"]) {
  const fs = createMemoryFileSystem();
  const shell = mode === "factory"
    ? new Shell({ fs, commands: new CommandRegistry(createAgentCommands(aggregateOptions)) })
    : new Shell({ fs }).use(mode === "standalone" ? plugin : agentCommands(aggregateOptions));
  try {
    for (const fixture of [
      { command: "tac", input: "old\nnew\n", output: "new\nold\n" },
      { command: "expand -4", input: "a\tb\n", output: "a   b\n" },
      { command: "fold -3", input: "abcdefg", output: "abc\ndef\ng" },
      { command: "strings -5", input: "four\0fives\0ending", output: "fives\nending\n" },
    ]) {
      const result = await shell.exec(fixture.command, { stdin: fixture.input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, fixture.output);
      results.push({ mode, command: fixture.command, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex") });
    }
    if (mode !== "standalone") {
      const report = await shell.exec("printf 'old\\tline\\nnew\\tline\\n' > log; tac log | expand -4 | fold -bw8 > report; cat report");
      assert.equal(report.exitCode, 0, report.stderr);
      assert.equal(report.stdout, "new line\nold line\n");
      const bytes = await shell.exec("tac | expand | fold -b -w80 > binary; cat binary", { stdin: Uint8Array.of(255, 0, 120, 10, 89, 10) });
      assert.equal(bytes.exitCode, 0, bytes.stderr);
      assert.deepEqual(bytes.stdoutBytes, Uint8Array.of(89, 10, 255, 0, 120, 10));
      assert.deepEqual(new Uint8Array(await fs.readFile("/binary")), bytes.stdoutBytes);
    }
  } finally { await shell.dispose(); }
}
console.log(JSON.stringify({ rootResolution, subpathResolution, count: names.length, unique: new Set(names).size, names, optionalAbsent: true, results, aggregatePipelineModes: 2 }));
