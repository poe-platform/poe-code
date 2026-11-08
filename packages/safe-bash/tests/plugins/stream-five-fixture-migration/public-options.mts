import assert from "node:assert/strict";
import {
  agentCommands, createAgentCommands, createMemoryFileSystem, Shell,
  createStreamFormatCommands, streamFormatCommands, createSplitCommands, splitCommands,
  type AgentCommandsOptions, type StreamFormatCommandsOptions, type StreamFormatLimits,
  type SplitCommandsOptions, type SplitLimits,
} from "virtual-bash";
import {
  createStreamFormatCommands as formatFactory, streamFormatCommands as formatPlugin,
  type StreamFormatCommandsOptions as SubpathFormatOptions, type StreamFormatLimits as SubpathFormatLimits,
} from "virtual-bash/commands/stream-format";
import {
  createSplitCommands as splitFactory, splitCommands as splitPlugin,
  type SplitCommandsOptions as SubpathSplitOptions, type SplitLimits as SubpathSplitLimits,
} from "virtual-bash/commands/split";

const formatLimits: Partial<StreamFormatLimits> = { maxInputBytes: 1024 * 1024 };
const subpathFormatLimits: Partial<SubpathFormatLimits> = formatLimits;
const formatOptions: StreamFormatCommandsOptions = { limits: subpathFormatLimits };
const subpathFormatOptions: SubpathFormatOptions = formatOptions;
const splitLimits: Partial<SplitLimits> = { maxFiles: 128 };
const subpathSplitLimits: Partial<SubpathSplitLimits> = splitLimits;
const splitOptions: SplitCommandsOptions = { limits: subpathSplitLimits };
const subpathSplitOptions: SubpathSplitOptions = splitOptions;
const aggregate: AgentCommandsOptions = { streamFormat: subpathFormatOptions, split: subpathSplitOptions };
const formatReplaceTopLevel: "replace" extends keyof NonNullable<AgentCommandsOptions["streamFormat"]> ? false : true = true;
const splitReplaceTopLevel: "replace" extends keyof NonNullable<AgentCommandsOptions["split"]> ? false : true = true;
assert.equal(formatReplaceTopLevel, true);
assert.equal(splitReplaceTopLevel, true);
assert.equal(createStreamFormatCommands, formatFactory);
assert.equal(streamFormatCommands, formatPlugin);
assert.equal(createSplitCommands, splitFactory);
assert.equal(splitCommands, splitPlugin);
assert.deepEqual(formatFactory(formatOptions).map(command => command.name), ["seq", "nl", "rev", "unexpand"]);
assert.deepEqual(splitFactory(splitOptions).map(command => command.name), ["split"]);
const expectedNames = [
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch", "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath",
  "ls", "cat", "head", "tail", "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find", "sed", "awk", "jq", "rg",
  "base64", "base32", "xxd", "od", "sha256sum", "sha1sum", "md5sum", "cksum", "gzip", "gunzip", "zcat", "diff", "patch", "chmod", "stat", "mktemp", "tar",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split", "date", "sleep", "printenv", "tree", "file",
  "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "git",
];
assert.deepEqual(createAgentCommands(aggregate).map(command => command.name), expectedNames);
assert.equal(createAgentCommands(aggregate).length, expectedNames.length);
assert.equal(createAgentCommands(aggregate).at(75)?.name, "expr");

const instance = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands(aggregate));
try {
  const result = await instance.exec("seq 2 | split -l1; cat xaa xab");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\n2\n");
  assert.deepEqual(instance.commands.list().map(command => command.name), expectedNames);
  assert.equal(instance.commands.list().length, expectedNames.length);
} finally { await instance.dispose(); }

const standaloneFormat = new Shell({ fs: createMemoryFileSystem() }).use(formatPlugin(formatOptions));
try {
  const result = await standaloneFormat.exec("seq 2 | rev | nl -ba | unexpand");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(standaloneFormat.commands.list().length, 4);
  assert.equal(standaloneFormat.commands.has("split"), false);
} finally { await standaloneFormat.dispose(); }
const fs = createMemoryFileSystem();
const standaloneSplit = new Shell({ fs }).use(splitPlugin(splitOptions));
try {
  const result = await standaloneSplit.exec("split -b2", { stdin: "abc" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(standaloneSplit.commands.list().length, 1);
  assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "ab");
  assert.equal(Buffer.from(await fs.readFile("/xab")).toString(), "c");
} finally { await standaloneSplit.dispose(); }
const resolutions = Object.fromEntries(["virtual-bash", "virtual-bash/commands/stream-format", "virtual-bash/commands/split"].map(name => [name, import.meta.resolve(name)]));
for (const resolution of Object.values(resolutions)) assert.ok(resolution.includes("/consumer/node_modules/virtual-bash/dist/"), resolution);
console.log(JSON.stringify({ resolutions, defaultCount: expectedNames.length, standaloneFormatCount: 4, standaloneSplitCount: 1, aggregatePipeline: "1\n2\n", formatReplaceTopLevel, splitReplaceTopLevel }));
