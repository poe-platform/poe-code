import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

const cases = [
  ...["n", "N", "u"].flatMap(flag => ["\\n", "\\r", "\\v", "\\f"].map(space => ({
    name: `decimal -${flag} accepts trailing ${space}`,
    fixture: "review.test.ts",
    script: ` read -${flag} $'${flag === "u" ? "0" : "2"}${space}' value; printf '%s:' "$?"; read -r tail; printf "<%s><%s>" "$value" "$tail"`,
    input: "abcd\n",
  }))),
  { name: "signed decimal accepts C whitespace at both ends", fixture: "review.test.ts", script: ` read -n $'\\t+0002\\r' value; printf '%s:' "$?"; read -r tail; printf "<%s><%s>" "$value" "$tail"`, input: "abcd\n" },
  ...["-0.1", "-.1", "-00.000001", "-0.0000005", "-0.9999999"].map(value => ({
    name: `reject converted negative fractional timeout ${value}`,
    fixture: "timed-review.test.ts",
    script: `value=OLD; read -t '${value}' -n0 value; printf '%s:<%s>;' "$?" "$value"; read -r tail; printf '<%s>' "$tail"`,
    input: "untouched\n",
  })),
  ...["-Q", "--bogus", "-a", "-t"].map(args => ({ name: `primary usage ${args}`, fixture: "native.test.ts", script: `read ${args}`, input: "one\n" })),
  { name: "readonly default REPLY has status two", script: 'readonly REPLY=OLD; read; printf "%s:<%s>" "$?" "$REPLY"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "readonly only scalar retains status one", script: 'readonly first=OLD; read first; printf "%s:<%s>" "$?" "$first"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "readonly non-final scalar has status two", script: 'readonly first=OLD; read first last; printf "%s:<%s><%s>" "$?" "$first" "$last"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "readonly final scalar retains status one", script: 'readonly last=OLD; read first last; printf "%s:<%s><%s>" "$?" "$first" "$last"', fixture: "primary53.test.ts", input: "one two\n" },
  { name: "declared nonterminal -E accepts the input record", script: 'read -E value; printf "%s:<%s>" "$?" "$value"', fixture: "primary53.test.ts", input: "one two\n", nonTerminalInput: true },
];

for (const entry of cases) test(`primary 5.3 actual Shell: ${entry.name}`, async context => {
  const expected = primaryReference(entry.fixture, entry.script, entry.input);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: ["nonTerminalInput" in entry ? readExtension({ nonTerminalInput: entry.nonTerminalInput }) : readExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(entry.script, { stdin: Buffer.from(entry.input), env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, expected.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
  assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
});

test("primary references reject changed program bytes", () => {
  assert.throws(() => primaryReference("native.test.ts", "read -Q ", "one\n"), /Missing exact primary/u);
});

test("primary references reject changed input bytes", () => {
  assert.throws(() => primaryReference("native.test.ts", "read -Q", "two\n"), /Missing exact primary/u);
});

test("primary references reject changed held-input protocol", () => {
  assert.throws(() => primaryReference("native.test.ts", "read -Q", "one\n", [{ fd: 0, method: "end", hex: "" }]), /Missing exact primary/u);
});
