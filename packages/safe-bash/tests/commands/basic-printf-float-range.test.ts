import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

// GNU Bash 5.3 on x86_64 Linux reports ERANGE and status 1 for these operands.
for (const operand of ["1e+5000", "1e5000", "1e-5000", "0x1p20000", "0x1p-20000"]) {
  for (const sign of ["", "-"]) for (const format of ["%g", "%a", "%G", "%A"]) {
    test(`printf reports floating range errors for ${format} ${sign}${operand}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
      try {
        const input = sign + operand;
        const underflow = operand.includes("e-") || operand.includes("p-");
        let output = sign + (underflow ? format.toLowerCase() === "%a" ? "0x0p+0" : "0" : "inf");
        if (format === format.toUpperCase()) output = output.toUpperCase();
        const result = await shell.exec(`printf '${format}' '${input}'`, { env: { LC_ALL: "C", TZ: "UTC" } });
        assert.equal(result.stdout, output);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stderr, `printf: ${input}: Numerical result out of range\n`);
      } finally { await shell.dispose(); }
    });
  }
}

test("printf retains valid floating controls without range errors", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec("printf '%a\\n' 0x1p50 0e5000 -0e-5000 0x0p20000 -0x0p-20000 inf -inf");
    assert.equal(result.stdout, "0x8p+47\n0x0p+0\n-0x0p+0\n0x0p+0\n-0x0p+0\ninf\n-inf\n");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const route of ["assignment", "substitution", "loop", "redirection"]) {
  test(`printf retains range output and status through ${route}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const invocation = "printf '%g|%a' 1e5000 -1e-5000";
      const capture = 'status=$?; printf "%s:%s" "$result" "$status"';
      const script = route === "assignment" ? `printf -v result '%g|%a' 1e5000 -1e-5000; ${capture}`
        : route === "substitution" ? `result=$(${invocation}); ${capture}`
        : route === "loop" ? `for value in 1; do ${invocation}; done; printf ':%s' $?`
        : `${invocation} > /printed; status=$?; printf '%s:%s' "$(< /printed)" "$status"`;
      const result = await shell.exec(script);
      assert.equal(result.stdout, "inf|-0x0p+0:1");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "printf: 1e5000: Numerical result out of range\nprintf: -1e-5000: Numerical result out of range\n");
    } finally { await shell.dispose(); }
  });
}

for (const raw of [false, true]) {
  test(`printf range diagnostics retain output, padding and later operands raw=${raw}`, async () => {
    const chunks: Uint8Array[] = [], diagnostics: Uint8Array[] = [];
    const args = ["[%+08G][%a]:%s", "1e5000", "-1e-5000", "done"];
    const argumentValues = createCommandArguments(raw ? args.map(value => shellValueFromBytes(Buffer.from(value))) : args);
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/", env: { LC_ALL: "C" },
      fs: new MemoryFileSystem(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { diagnostics.push(bytes.slice()); } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.concat(chunks).toString(), "[    +INF][-0x0p+0]:done");
    assert.equal(Buffer.concat(diagnostics).toString(), "printf: 1e5000: Numerical result out of range\nprintf: -1e-5000: Numerical result out of range\n");
  });
}

for (const [operand, output, rangeError] of [
  ["0xf.fffffffffffffffp16380", "0xf.fffffffffffffffp+16380", false],
  ["0xf.fffffffffffffff8p16380", "inf", true],
  ["1.189731495357231765e4932", "0xf.fffffffffffffffp+16380", false],
  ["1.189731495357231766e4932", "inf", true],
  ["0x1p-16445", "0x0.000000000000001p-16385", false],
  ["0x1p-16446", "0x0p+0", true],
  ["1.822599765941237301e-4951", "0x0p+0", true],
  ["1.822599765941237302e-4951", "0x0.000000000000001p-16385", true],
  ["1e" + "9".repeat(300), "inf", true],
  ["1e-" + "9".repeat(300), "0x0p+0", true],
] as const) {
  test(`printf distinguishes range boundaries for ${operand}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(`printf '%a' '${operand}'`);
      assert.equal(result.stdout, output);
      assert.equal(result.exitCode, rangeError ? 1 : 0);
      assert.equal(result.stderr, rangeError ? `printf: ${operand}: Numerical result out of range\n` : "");
    } finally { await shell.dispose(); }
  });
}

test("printf diagnoses trailing input before range errors and retains the converted prefix", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec("printf '%g|' 1e5000junk -1e-5000junk");
    assert.equal(result.stdout, "inf|-0|");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "printf: '1e5000junk': invalid number\nprintf: '-1e-5000junk': invalid number\n");
  } finally { await shell.dispose(); }
});
