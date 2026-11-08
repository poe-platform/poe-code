import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { gnuStringsCases } from "./gnu-strings-cases.js";
import { fixture, runFixture } from "./helpers.js";

interface Observation { id: string; command: string; fixtureSha256: string; status: number; signal: string | null; stdoutHex: string; stderrHex: string }
interface Evidence { observations: Observation[] }
const evidence: Evidence = JSON.parse(readFileSync(new URL("./evidence/gnu-strings.json", import.meta.url), "utf8"));

for (const encoding of ["s", "S", "l", "b", "L", "B"]) {
  for (const flag of [["-e", encoding], [`--encoding=${encoding}`]]) {
    test(`strings encoding ${flag.join(" ")} across byte chunks`, async () => {
      const width = encoding === "l" || encoding === "b" ? 2 : encoding === "L" || encoding === "B" ? 4 : 1;
      const bytes = Buffer.alloc(22 * width);
      Array.from("ControlOne\0ControlTwo\0").forEach((character, index) => {
        bytes[index * width + (encoding === "b" || encoding === "B" ? width - 1 : 0)] = character.charCodeAt(0);
      });
      const result = await runFixture(fixture("encoding", "strings", flag, bytes), {}, {}, 1);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "ControlOne\nControlTwo\n");
    });
  }
}

for (const [mode, short, expected] of [
  ["default", "d", "Controlcaf\n"], ["invalid", "i", "Controlcaf\n"],
  ["locale", "l", "Controlcafé😀End\n"],
  ["hex", "x", "Controlcaf<0xc3a9><0xf09f9880>End\n"],
  ["escape", "e", "Controlcaf\\u00e9\\u07c600End\n"],
  ["highlight", "h", "Controlcaf\\u00e9\\u07c600End\n"],
]) {
  for (const flag of [["-U", short!], [`--unicode=${mode}`]]) {
    test(`strings Unicode ${flag.join(" ")} across byte chunks`, async () => {
      const result = await runFixture(fixture("unicode", "strings", flag, "\0Controlcafé😀End\0"), {}, {}, 1);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    });
  }
}

for (const specimen of gnuStringsCases) {
  test(`GNU2.44 strings: ${specimen.id}`, async () => {
    const native = evidence.observations.find(row => row.id === specimen.id)!;
    assert.equal(native.fixtureSha256, createHash("sha256").update(JSON.stringify(specimen)).digest("hex"));
    assert.equal(native.signal, null);
    const result = await runFixture(specimen, {}, {}, 4093);
    if (specimen.id === "gnu-lone-dash-stdin") {
      assert.equal(native.status, 1);
      assert.match(Buffer.from(native.stderrHex, "hex").toString(), /^Usage: .*strings \[option\(s\)\] \[file\(s\)\]/u);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, "strings: missing file operand after '-' (use no operands for stdin)\n");
    } else {
      assert.equal(native.status, 0); assert.equal(native.stderrHex, "");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
    }
    assert.equal(result.stdoutHex, native.stdoutHex);
  });
}

test("strings 8-bit preserves raw high bytes and Unicode counts characters", async () => {
  const raw = await runFixture(fixture("raw", "strings", ["-eS"], Uint8Array.from([65, 66, 233, 67, 0])));
  assert.equal(raw.stdoutHex, "4142e9430a");
  const short = await runFixture(fixture("minimum", "strings", ["-Ux"], "ééé\0"), {}, {}, 1);
  assert.equal(short.stdout, "");
  const offset = await runFixture(fixture("offset", "strings", ["-Ux", "-td"], "\0éABC\0"), {}, {}, 1);
  assert.equal(offset.stdout, "      1 <0xc3a9>ABC\n");
});

test("strings encoding and Unicode validate options and retain record budgets", async () => {
  for (const args of [["-ez"], ["-Us"], ["--unicode=show"]]) {
    const result = await runFixture(fixture("invalid", "strings", args, "Control"));
    assert.equal(result.exitCode, 1);
  }
  const result = await runFixture(fixture("budget", "strings", ["-Ux"], "éABC"), { limits: { maxRecordBytes: 5 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /record limit exceeded/u);
});
