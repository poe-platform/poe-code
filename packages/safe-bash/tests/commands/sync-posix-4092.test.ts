import { stringsCommands } from "../../src/commands/strings/index.js";
import { streamFormatCommands } from "../../src/commands/stream-format/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

const classes = [
  ["digit", "123", "abc"], ["space", " \t", "keep"],
  ["alpha", "abc", "123"], ["alnum", "a1", "!"],
  ["upper", "HELLO", "world"], ["lower", "world", "HELLO"],
  ["blank", " \t", "keep"], ["xdigit", "aF9", "xyz"],
  ["punct", "![]", "abc"],
] as const;

async function verify(command: string, expected: string): Promise<void> {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use(standardCommands()).use(textProgramCommands()).use(streamFormatCommands()).use(stringsCommands());
  try {
    for (const script of [command, `x=$(${command}); printf '%s\\n' "$x"`, `for i in 1 2; do x=$(${command}); done; printf '%s\\n' "$x"`]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, script);
      assert.equal(result.stderr, "", script);
      assert.equal(result.stdout, expected, script);
    }
  } finally { await shell.dispose(); }
}

for (const [name, matching, other] of classes) {
  const input = `<<< '${matching}\n${other}'`;
  for (const condition of [`/^[[:${name}:]]+$/`, `$1 ~ /^[[:${name}:]]+$/`, `!/^[[:${name}:]]+$/`, `$1 !~ /^[[:${name}:]]+$/`]) {
    // Whitespace fields disappear with awk's default field separator.
    if (condition.startsWith("$1") && (name === "space" || name === "blank")) continue;
    test(`sync awk ${condition}`, () => verify(`awk '${condition} { print $0 }' ${input}`, `${condition.startsWith("!") || condition.includes("!~") ? other : matching}\n`));
  }
  test(`sync sed ${name} address`, () => verify(`sed '/[[:${name}:]]/d' ${input}`, `${other}\n`));
  test(`sync nl ${name} body pattern`, () => verify(`nl -b 'p^[[:${name}:]]' ${input}`, `     1\t${matching}\n       ${other}\n`));
}
for (const option of ["-s :", "-s:", "--output-separator :", "--output-separator=:"]) {
  test(`sync strings ${option}`, async () => {
    // Frame output to observe separators without depending on a trailing newline.
    await verify(`x=$(strings ${option} <<< 'hello\nworld'); printf '%s\\n' "$x"`, "hello:world:\n");
  });
}
test("sync strings empty separator", () => verify("x=$(strings -s '' <<< 'hello\nworld'); printf '%s\\n' \"$x\"", "helloworld\n"));
test("sync strings no qualifying runs", () => verify("x=$(strings -s : <<< 'abc'); printf '%s\\n' \"$x\"", "\n"));
test("sync strings separator with offsets", () => verify("x=$(strings -td -s : <<< 'hello\nworld'); printf '%s\\n' \"$x\"", "      0 hello:      6 world:\n"));
test("sync awk negated space-only rows", () => verify("awk '!/^[[:space:]]*$/ { print $0 }' <<< '   \nkeep'", "keep\n"));
test("sync awk mixed and negated bracket classes", () => verify("awk '/^[^[:digit:][:upper:]]+$/ { print $0 }' <<< 'abc\nABC\n123'", "abc\n"));
test("sync awk last field class", () => verify("awk '$NF ~ /^[[:digit:]]+$/ { print $0 }' <<< 'keep 123\ndrop abc'", "keep 123\n"));
test("sync awk second field negated class", () => verify("awk '$2 !~ /^[[:upper:]]+$/ { print $0 }' <<< 'drop ABC\nkeep abc'", "keep abc\n"));
test("sync sed punct class includes backslash, closing bracket, caret and hyphen", () => verify("sed '/[[:punct:]]/d' <<< ']\n^\n-\n\\\nkeep'", "keep\n"));
test("sync sed mixed negated class", () => verify("sed '/[^[:digit:][:upper:]]/d' <<< '123\nABC\nabc'", "123\nABC\n"));
test("sync nl mixed negated class", () => verify("nl -b 'p^[^[:digit:][:upper:]]' <<< 'abc\nABC\n123'", "     1\tabc\n       ABC\n       123\n"));
