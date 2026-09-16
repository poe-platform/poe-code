import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

test("mapfile variant requires explicit replacement of current core builtins", async context => {
  const ordinary = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension()] });
  context.after(() => ordinary.dispose());
  await assert.rejects(ordinary.exec(":"), /Extension builtin conflicts with existing builtin: mapfile/);
  const replacement = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension({ replace: true })] });
  context.after(() => replacement.dispose());
  const result = await replacement.exec("mapfile -t values", { stdin: "one\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(mapfileExtension({ replace: true }).create().builtins.map(builtin => builtin.replace), [true, true]);
});

test("mapfile declares the generic array-key syntax directly", () => {
  assert.deepEqual(mapfileExtension({ replace: true }).syntax, { arrayKeys: true });
  assert.deepEqual(mapfileExtension({ replace: true }).syntax?.arrayKeys, arraysExtension().syntax?.arrayKeys);
  assert.deepEqual(mapfileExtension({ replace: true }).create().builtins.map(builtin => builtin.name), ["mapfile", "readarray"]);
});

const cases = [
  ...["mapfile", "readarray"].map(command => ({
    name: `${command} directly enables unsigned array keys`,
    extensions: () => [mapfileExtension({ replace: true })],
    script: `${command} -t -O4294967295 a; printf '<%s>' "\${!a[@]}"; printf 'values=<%s><%s>' "\${a[4294967295]}" "\${a[0]}"`,
  })),
  ...[false, true].map(arraysFirst => ({
    name: `identical syntax declarations deduplicate with arrays first=${arraysFirst}`,
    extensions: () => arraysFirst ? [arraysExtension(), mapfileExtension({ replace: true })] : [mapfileExtension({ replace: true }), arraysExtension()],
    script: `mapfile -tn1 -O3 a; readarray -tn1 -O7 b; printf 'a=<%s>;b=<%s>' "\${!a[@]}" "\${!b[@]}"`,
  })),
  {
    name: "mapfile array-key syntax survives subshell and substitution forks",
    extensions: () => [mapfileExtension({ replace: true })],
    script: `mapfile -t -O3 a; (printf 'child=<%s>' "\${!a[@]}"); printf 'sub=<%s>;parent=<%s>' "$(printf '<%s>' "\${!a[@]}")" "\${!a[*]}"`,
  },
];

for (const entry of cases) test(entry.name, {}, async context => {
  const input = "one\ntwo\n";
  const expected = primaryReference(import.meta.url, entry.script, input);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: entry.extensions() });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(entry.script, { stdin: Buffer.from(input) });
  assert.equal(actual.exitCode, expected.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr);
});

test("constructing optional factories preserves current default array-key support", async context => {
  mapfileExtension({ replace: true });
  arraysExtension();
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(`a=(one two); printf '<%s>' "\${!a[@]}"`);
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout, "<0><1>");
  assert.equal(actual.stderr, "");
});
