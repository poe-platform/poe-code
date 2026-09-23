import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../../src/index.js";

for (const separator of [Buffer.from([58, 0x81, 58]), Buffer.from([0xc1]), Buffer.from([0xfe]), Buffer.from([0xff]), Buffer.from(""), Buffer.from(":"), Buffer.from("é"), Buffer.from("�")]) {
  for (const option of ['-s "$chosen"', '-s"$chosen"', '--number-separator "$chosen"', '--number-separator="$chosen"']) {
    // An empty attached short value leaves bare -s, which consumes the filename.
    if (!separator.length && option === '-s"$chosen"') continue;
    for (const format of ["rn", "ln", "rz"]) {
      test(`nl preserves separator ${separator.toString("hex")} with ${option} and ${format}`, async () => {
        const fs = createMemoryFileSystem();
        const instance = new Shell({ fs }).use(agentCommands());
        try {
          await fs.writeFile("/separator", separator);
          await fs.writeFile("/records", Buffer.from("One\n\nTwo\n"));
          await fs.writeFile("/script", Buffer.from(`chosen=$(cat /separator); nl -w4 -n${format} ${option} /records > /actual; cat /actual`));
          const result = await instance.exec("sh /script");
          const label = (number: number) => format === "ln" ? `${number}   ` : format === "rz" ? `000${number}` : `   ${number}`;
          const expected = Buffer.concat([Buffer.from(label(1)), separator, Buffer.from("One\n" + " ".repeat(4 + separator.length) + "\n" + label(2)), separator, Buffer.from("Two\n")]);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual(Buffer.from(result.stdoutBytes), expected);
          assert.deepEqual(Buffer.from(await fs.readFile("/actual")), expected);
          assert.deepEqual(Buffer.from(await fs.readFile("/separator")), separator);
        } finally { await instance.dispose(); }
      });
    }
  }
}

test("nl admits raw argument and number-field bytes at their exact limits", async () => {
  for (const [maxArgumentBytes, maxRecordBytes, succeeds] of [[6, 2, true], [5, 2, false], [6, 1, false]] as const) {
    const fs = createMemoryFileSystem();
    const instance = new Shell({ fs }).use(agentCommands({ streamFormat: { limits: { maxArgumentBytes, maxRecordBytes } } }));
    try {
      await fs.writeFile("/s", Uint8Array.of(255));
      const result = await instance.exec('nl -w1 -s "$(cat /s)"', { stdin: "a\n" });
      assert.equal(result.exitCode, succeeds ? 0 : 1, result.stderr);
      if (succeeds) assert.deepEqual(result.stdoutBytes, Uint8Array.of(49, 255, 97, 10));
      else { assert.match(result.stderr, /limit exceeded/); assert.equal(result.stdoutBytes.length, 0); }
    } finally { await instance.dispose(); }
  }
});

test("nl uses the last separator's byte identity while numbering blank lines", async () => {
  const fs = createMemoryFileSystem();
  const instance = new Shell({ fs }).use(agentCommands());
  try {
    await fs.writeFile("/first", Uint8Array.of(254));
    await fs.writeFile("/last", Uint8Array.of(255));
    for (const format of ["rn", "ln", "rz"]) {
      const result = await instance.exec(`nl -ba -w2 -n${format} -s "$(cat /first)" --number-separator="$(cat /last)"`, { stdin: "A\n\nB\n" });
      const expected = Buffer.concat([1, 2, 3].map((number, index) => Buffer.concat([
        Buffer.from(format === "ln" ? `${number} ` : format === "rz" ? `0${number}` : ` ${number}`),
        Uint8Array.of(255), Buffer.from(["A\n", "\n", "B\n"][index]!),
      ])));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), expected);
    }
  } finally { await instance.dispose(); }
});
