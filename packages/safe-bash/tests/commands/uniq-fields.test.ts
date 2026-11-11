import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { Shell } from "../../src/shell/shell.js";
import { chunks, fixture, run } from "./helpers.js";

for (const [name, hex, locale, zero, expected] of [
  ["embedded newline", "410a7800420a7900", "C", true, "410a7800420a7900"],
  ["tab control", "4109780042097900", "C", true, "4109780042097900"],
  ["UTF-8 EM SPACE", "41e28083780a42e28083790a", "C.utf8", false, "41e28083780a42e28083790a"],
  ["C EM SPACE control", "41e28083780a42e28083790a", "C", false, "41e28083780a"],
] as const) {
  test(`uniq -f uses native field boundaries: ${name}`, async () => {
    const input = Buffer.from(hex, "hex");
    for (const source of ["stdin", "file"]) {
      const fs = await fixture({ in: input, out: "KEEP", "-": "DASH", "+1": "named\n" });
      const result = await run("uniq", ["-f1", ...(zero ? ["-z"] : []), ...(source === "file" ? ["in"] : [])], {
        fs, commands: textCommands(), stdin: chunks(input), env: { LC_ALL: locale },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Buffer.from(expected, "hex"));
      assert.deepEqual(Buffer.from(await fs.readFile("/work/in")), input);
      for (const [path, content] of [["out", "KEEP"], ["-", "DASH"], ["+1", "named\n"]] as const) {
        assert.equal(Buffer.from(await fs.readFile(`/work/${path}`)).toString(), content);
      }
    }
  });
}

test("uniq -f distinguishes locale blanks from other whitespace", async () => {
  // GNU 9.7 newline_or_blank: LF plus the GNU/Linux C.UTF-8 blank class.
  const blanks = [0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2008, 0x2009, 0x200a, 0x205f, 0x3000];
  const nonblanks = [0x0b, 0x0c, 0x0d, 0x85, 0xa0, 0x2007, 0x200b, 0x2028, 0x2029, 0x202f, 0xfeff];
  for (const locale of ["C", "POSIX", "C.utf8"]) {
    for (const point of [9, 10, 32, ...blanks, ...nonblanks]) {
      const separator = String.fromCodePoint(point);
      const first = `A${separator}x\0`;
      const input = `${first}B${separator}y\0`;
      const boundary = point === 9 || point === 10 || point === 32 || locale === "C.utf8" && blanks.includes(point);
      const result = await run("uniq", ["-zf1"], { commands: textCommands(), stdin: chunks(input), env: { LC_ALL: locale } });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, boundary ? input : first, `${locale} U+${point.toString(16)}`);
    }
  }
});

test("uniq -f uses LC_ALL, LC_CTYPE, then LANG for field boundaries", async () => {
  const input = "A\u2003x\nB\u2003y\n";
  for (const [env, unicode] of [
    [{ LC_ALL: "C", LC_CTYPE: "C.utf8", LANG: "C.utf8" }, false],
    [{ LC_ALL: "C.utf8", LC_CTYPE: "C", LANG: "C" }, true],
    [{ LC_ALL: "", LC_CTYPE: "POSIX", LANG: "C.utf8" }, false],
    [{ LC_ALL: "", LC_CTYPE: "C.utf8", LANG: "C" }, true],
    [{ LC_ALL: "", LC_CTYPE: "", LANG: "C.utf8" }, true],
    [{ LANG: "C" }, false],
    [{}, false],
  ] as const) {
    const result = await run("uniq", ["-f1"], { commands: textCommands(), stdin: input, env });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, unicode ? input : "A\u2003x\n");
  }
});

for (const [name, env, unicode] of [
  ["unset", {}, false],
  ["empty", { LC_ALL: "", LC_CTYPE: "", LANG: "" }, false],
  ["unavailable", { LC_ALL: "not_installed.UTF-8" }, false],
  ["failed time category", { LC_CTYPE: "C.UTF-8", LC_TIME: "not_installed.UTF-8" }, false],
  ["C", { LC_ALL: "C" }, false],
  ["UTF-8", { LC_ALL: "C.UTF-8" }, true],
  ["override invalid category", { LC_ALL: "C.UTF-8", LC_TIME: "not_installed.UTF-8" }, true],
] as const) {
  test(`uniq resolves character and field boundaries with ${name} locale`, async () => {
    for (const [option, input, expected] of [
      ["-w1", "éA\nêA\n", unicode ? "éA\nêA\n" : "éA\n"],
      ["-s1", "éA\nêA\n", unicode ? "éA\n" : "éA\nêA\n"],
      ["-f1", "a\u2003A\nb\u2003B\n", unicode ? "a\u2003A\nb\u2003B\n" : "a\u2003A\n"],
    ] as const) {
      const fs = await fixture({ in: input });
      for (const source of ["stdin", "file"]) {
        const result = await run("uniq", [option, ...(source === "file" ? ["in"] : [])], {
          fs, commands: textCommands(), stdin: chunks(input), env,
        });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, Buffer.from(expected), `${option} ${source}`);
      }
      const shell = new Shell({ fs, cwd: "/work", env }).use({ setup({ commands }) {
        for (const command of textCommands()) commands.register(command);
      } });
      try {
        for (const script of [`uniq ${option} in`, `uniq ${option} < in`, `uniq in | uniq ${option}`]) {
          const result = await shell.exec(script);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(expected), script);
        }
      } finally { await shell.dispose(); }
    }
  });
}

test("uniq skips leading blanks and whole fields before applying -s and -w", async () => {
  for (const separator of ["\n", "\u2003"]) {
    const first = `${separator}one${separator}two${separator}xSAME1\0`;
    const input = `${first}${separator}three${separator}four${separator}ySAME2\0${separator}five${separator}six${separator}zDIFF3\0`;
    const result = await run("uniq", ["-zf2", "-s2", "-w4"], { commands: textCommands(), stdin: chunks(input), env: { LC_ALL: "C.utf8" } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `${first}${separator}five${separator}six${separator}zDIFF3\0`);
  }
  const input = "A\u2003x\nB\u2003\u2003x\n";
  const result = await run("uniq", ["-f1"], { commands: textCommands(), stdin: input, env: { LC_ALL: "C.utf8" } });
  assert.equal(result.stdout, input, "the blanks after a skipped field remain part of the comparison key");
});

test("uniq -f preserves invalid UTF-8 around valid blank boundaries", async () => {
  for (const hex of [
    "ffe28083780afee28083790a",
    "41e28083ff0a42e28083fe0a",
    "41e280780a42e280790a",
    "41e2a083780a42e2a083790a",
  ]) {
    const input = Buffer.from(hex, "hex");
    const boundary = hex.includes("e28083");
    const result = await run("uniq", ["-f1"], { commands: textCommands(), stdin: chunks(input), env: { LC_ALL: "C.utf8" } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, boundary ? input : input.subarray(0, input.indexOf(10) + 1));
  }
});
