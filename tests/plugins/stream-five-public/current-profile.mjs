import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const historicalHarnessSha256 = "6fa5b5e445500e0ab29be962e9c5ac39a7e2e830fc736fd344e0580778c0f3ae";
export const sha256 = value => createHash("sha256").update(value).digest("hex");

const expectedCurrentCommands = [
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
  "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
  "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
  "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha256sum", "sha1sum",
  "md5sum", "cksum", "gzip", "gunzip", "zcat", "diff", "patch", "chmod", "stat", "mktemp", "tar",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
  "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown",
  "du", "expr", "which", "timeout", "apply_patch", "git",
];

export function currentProfile(original) {
  assert.equal(sha256(original), historicalHarnessSha256, "historical harness must remain byte-exact");
  let source = original.toString();
  const deltas = [];
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, `expected exactly one migration site: ${before}`);
    source = source.replace(before, after);
    deltas.push({ before, after });
  };
  replace('const commands = ["seq", "nl", "rev", "unexpand", "split"];', `const commands = ["seq", "nl", "rev", "unexpand", "split"];\nconst expectedCurrentCommands = ${JSON.stringify(expectedCurrentCommands)};`);
  replace('.use(agentCommands()).use(streamFormatCommands()).use(splitCommands())', '.use(agentCommands())');
  replace('contract("default factory and actual default dispatch remain 60 without opt-in",', 'contract("current default factory and dispatch expose the exact 80-command catalog",');
  replace('  assert.equal(createAgentCommands().length, 60);\n  const fs', '  assert.deepEqual(createAgentCommands().map(command => command.name), expectedCurrentCommands);\n  const fs');
  replace('  const before = await snapshot(fs);\n  const instance = new Shell({ fs, cwd: "/fixture" }).use(agentCommands());', '  const instance = new Shell({ fs, cwd: "/fixture" }).use(agentCommands());');
  replace('      assert.equal(result.exitCode, 127);\n      assert.equal(result.stdout, "");\n      assert.equal(result.stderr, `shell: line 1: ${command}: command not found\\n`);\n      assert.equal(instance.commands.has(command), false);', '      assert.equal(result.exitCode, 0, result.stderr);\n      const expectedOutput: Record<string, string> = { seq: "1\\n2\\n3\\n", nl: "     1\\tabc\\n", rev: "cba\\n", unexpand: "abc\\n", split: "" };\n      assert.equal(result.stdout, expectedOutput[command]);\n      assert.equal(result.stderr, "");\n      assert.equal(instance.commands.has(command), true);');
  replace('    assert.equal(instance.commands.list().length, 60);\n    assert.deepEqual(await snapshot(fs), before);', '    assert.deepEqual(instance.commands.list().map(command => command.name), expectedCurrentCommands);\n    assert.equal(Buffer.from(await fs.readFile("/fixture/input")).toString(), "abc\\n");\n    assert.equal(Buffer.from(await fs.readFile("/fixture/xaa")).toString(), "abc\\n");');
  for (const limits of ['maxOutputBytes: 5, maxArgumentBytes: 20', 'maxInputBytes: 8, maxRecordBytes: 4']) {
    replace(`.use(streamFormatCommands({ limits: { ${limits} } }))`, `.use(agentCommands({ streamFormat: { limits: { ${limits} } } }))`);
  }
  for (const limits of ['maxFiles: 2, maxOutputBytes: 4', 'maxInputBytes: 5, maxArgumentBytes: 20']) {
    replace(`.use(splitCommands({ limits: { ${limits} } }))`, `.use(agentCommands({ split: { limits: { ${limits} } } }))`);
  }
  replace('.use(agentCommands()).use(splitCommands({ limits: { maxChunkBytes: 1024 } }))', '.use(agentCommands({ split: { limits: { maxChunkBytes: 1024 } } }))');
  replace('contract("default definitions still 60 at end of independent review", async () => {\n  assert.equal(createAgentCommands().length, 60);\n  assert.ok(commands.every(name => !createAgentCommands().some(command => command.name === name)));', 'contract("current default definitions retain the exact 80-command catalog after historical-corpus replay", async () => {\n  assert.deepEqual(createAgentCommands().map(command => command.name), expectedCurrentCommands);\n  assert.ok(commands.every(name => createAgentCommands().some(command => command.name === name)));');
  return { source, originalSha256: sha256(original), currentSha256: sha256(source), deltas };
}
