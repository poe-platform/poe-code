import assert from "node:assert/strict";
import test from "node:test";
import { chunks, native, nativePrograms, run } from "./helpers.js";

const known = {
  sha256sum: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  sha1sum: "a9993e364706816aba3e25717850c26c9cd0d89d",
  md5sum: "900150983cd24fb0d6963f7d28e17f72",
};

for (const name of ["sha256sum", "sha1sum", "md5sum"] as const) {
  test(`${name}: independently constructed escaped and zero-delimited filename records`, async () => {
    const names = ["back\\slash", "new\nline", "carriage\rreturn", "末尾😀", " leading ", "*binary", "-dash"];
    const quoted = ["back\\\\slash", "new\\nline", "carriage\\rreturn", "末尾😀", " leading ", "*binary", "-dash"];
    const fixture = { files: Object.fromEntries(names.map(filename => [filename, "abc"])) };
    for (const binary of [false, true]) {
      const expected = names.map((_, index) => `${index < 3 ? "\\" : ""}${known[name]} ${binary ? "*" : " "}${quoted[index]}\n`).join("");
      const generated = await run(name, [binary ? "-b" : "-t", "--", ...names], "", fixture);
      assert.equal(generated.exitCode, 0); assert.equal(generated.stdout.toString(), expected);
      const verified = await run(name, ["-c"], chunks(Buffer.from(expected), 1), fixture);
      assert.equal(verified.exitCode, 0, verified.stderr.toString());
      assert.equal(verified.stdout.toString(), names.map((_, index) => `${index < 3 ? "\\" : ""}${quoted[index]}: OK\n`).join(""));
    }
    const zero = await run(name, ["-z", "--", ...names], "", fixture);
    assert.equal(zero.stdout.toString(), names.map(filename => `${known[name]}  ${filename}\0`).join(""));
    const expectedZero = await native(nativePrograms[name], ["-z", "--", ...names], "", fixture);
    assert.equal(expectedZero.exitCode, 0); assert.deepEqual(zero.stdout, expectedZero.stdout);
  });

  test(`${name}: strict and reporting matrix uses fixed manifests, not generated values`, async () => {
    const good = `${known[name]}  data\n`;
    const bad = `${"0".repeat(known[name].length)}  data\n`;
    for (const [manifest, flags, code, stdout] of [
      [good, [], 0, "data: OK\n"], [good, ["--quiet"], 0, ""], [good, ["--status"], 0, ""],
      [good + "malformed\n", [], 0, "data: OK\n"], [good + "malformed\n", ["--strict"], 1, "data: OK\n"],
      [good + bad, ["--quiet"], 1, "data: FAILED\n"], [bad, ["--status"], 1, ""],
      [`${known[name]}  missing\n`, ["--ignore-missing"], 1, ""],
      [`${known[name]}  missing\n` + good, ["--ignore-missing"], 0, "data: OK\n"],
      ["# comment\n\n", [], 1, ""],
    ] as const) {
      const result = await run(name, ["-c", ...flags], chunks(Buffer.from(manifest), 7), { files: { data: "abc" } });
      assert.equal(result.exitCode, code, `${name} ${flags}: ${result.stderr}`);
      assert.equal(result.stdout.toString(), stdout);
    }
  });

  test(`${name}: manifest directory does not relocate paths; literal names and markers remain distinct`, async () => {
    const manifest = `\t${known[name].toUpperCase()} *data\r\n${known[name]}  *data\n${known[name]}   data\n`;
    const result = await run(name, ["-c", "nested/checks"], "", { files: { "nested/checks": manifest, data: "abc", "*data": "abc", " data": "abc", "nested/data": "wrong" } });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "data: OK\n*data: OK\n data: OK\n");
  });
}

for (const [name, algorithm] of [["sha256sum", "256"], ["sha1sum", "1"]] as const) test(`${name}: installed Perl shasum independently checks manifest statuses`, { skip: !nativePrograms.shasum }, async () => {
  const fixture = { files: { data: "abc", "space name": "abc" } };
  const good = `${known[name]}  data\n${known[name]}  space name\n`;
  for (const [manifest, flags] of [
    [good, []], [good, ["--quiet"]], [good, ["--status"]], [good + "invalid\n", ["--strict"]],
    [good + "invalid\n", ["--warn"]], [good.replaceAll(known[name], "0".repeat(known[name].length)), ["--quiet"]],
    [`${known[name]}  missing\n`, ["--ignore-missing"]], [good + `${known[name]}  missing\n`, ["--ignore-missing"]],
  ] as const) {
    const expected = await native(nativePrograms.shasum, ["-a", algorithm, "-c", ...flags], manifest, fixture);
    const actual = await run(name, ["-c", ...flags], chunks(Buffer.from(manifest), 2), fixture);
    assert.equal(actual.exitCode, expected.exitCode, `${flags}: ${actual.stderr}`);
    assert.deepEqual(actual.stdout, expected.stdout);
    assert.equal(actual.stderr.length > 0, expected.stderr.length > 0);
  }
});

test("checksum manifests reject malformed filename escapes and embedded NUL bytes", async () => {
  for (const suffix of ["bad\\x", "bad\\", "bad\0name"]) {
    const line = `\\${known.sha256sum}  ${suffix}\n`;
    const result = await run("sha256sum", ["-c", "--strict"], line);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString(), /no properly formatted/u);
  }
});

test("cksum independent bit-at-a-time polynomial and length folding", { skip: !nativePrograms.cksum }, async () => {
  const checksum = (data: Uint8Array) => {
    let crc = 0;
    const byte = (value: number) => {
      for (let bit = 7; bit >= 0; bit--) { const high = (crc >>> 31) ^ ((value >>> bit) & 1); crc = (crc << 1) ^ (high ? 0x04c11db7 : 0); }
    };
    for (const value of data) byte(value);
    let length = data.length;
    while (length) { byte(length & 255); length = Math.floor(length / 256); }
    return (~crc) >>> 0;
  };
  for (const length of [0, 1, 8, 255, 256, 257, 65535, 65536, 65537]) {
    const input = Uint8Array.from({ length }, (_, offset) => (offset * 53 + Math.floor(offset / 251)) & 255);
    const expected = `${checksum(input)} ${length}\n`;
    const actual = await run("cksum", [], chunks(input, 31));
    const installed = await native(nativePrograms.cksum, [], input);
    assert.equal(actual.stdout.toString(), expected); assert.equal(installed.stdout.toString(), expected);
  }
});
