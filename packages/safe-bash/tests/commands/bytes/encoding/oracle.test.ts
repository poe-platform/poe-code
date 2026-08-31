import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { allBytes, run } from "./helpers.js";

function native(executable: string, args: readonly string[], input: Uint8Array = new Uint8Array()) {
  return spawnSync(executable, [...args], { input, encoding: "buffer", env: { ...process.env, LC_ALL: "C" }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
}

function normalizeBsdOd(bytes: Uint8Array, hexadecimalAddresses: boolean): string {
  const text = Buffer.from(bytes).toString();
  const addresses = hexadecimalAddresses ? text.replace(/^0([0-9a-f]{6})(?=\s|$)/gmu, "$1") : text;
  return addresses.replace(/(?<=\d)-(?=\d)/gu, " -").trim().split(/\s+/u).join(" ");
}

test("od: BSD normalization removes only extra hexadecimal address padding", () => {
  const gnu = Buffer.from("000000 0100 0302\n000004\n");
  const bsd = Buffer.from("0000000  0100 0302\n0000004\n");
  assert.equal(normalizeBsdOd(bsd, true), normalizeBsdOd(gnu, true));
  assert.notEqual(normalizeBsdOd(bsd, false), normalizeBsdOd(gnu, false));
  assert.equal(normalizeBsdOd(Buffer.from("0000000  0000000 0000001\n*\n1000000  0002\n1000002\n"), true), "000000 0000000 0000001 * 1000000 0002 1000002");
  assert.equal(normalizeBsdOd(Buffer.from("00000000  01\n00000001\n"), true), "00000000 01 00000001");
  assert.notEqual(normalizeBsdOd(Buffer.from("0000000  0101 0302\n0000004\n"), true), normalizeBsdOd(gnu, true));
  assert.notEqual(normalizeBsdOd(Buffer.from("0000001  0100 0302\n0000004\n"), true), normalizeBsdOd(gnu, true));
  assert.notEqual(normalizeBsdOd(Buffer.from("0000000  0100 0302\n0000005\n"), true), normalizeBsdOd(gnu, true));
  assert.equal(normalizeBsdOd(Buffer.from("  127-128   -1\n"), false), "127 -128 -1");
});

for (const name of ["base64", "base32"] as const) test(`native GNU ${name}: valid vectors, wrapping and ignore garbage`, async context => {
  const executable = [...(process.env.BYTE_GNU_COREUTILS_DIR ? [join(process.env.BYTE_GNU_COREUTILS_DIR, name)] : []), `g${name}`, name].find(candidate => {
    const version = native(candidate, ["--version"]);
    return version.status === 0 && version.stdout.toString().includes("GNU coreutils");
  });
  if (!executable) { context.skip(`GNU ${name} not installed; static vectors still run`); return; }
  context.diagnostic(`${platform()} ${release()} ${arch()}; ${native(executable, ["--version"]).stdout.toString().split("\n")[0]}`);
  for (const args of [[], ["-w0"], ["-w1"], ["-w19"]]) {
    const expected = native(executable, args, allBytes);
    const actual = await run(name, args, allBytes);
    assert.equal(expected.status, actual.exitCode);
    assert.deepEqual(actual.bytes, expected.stdout);
    const decoded = native(executable, ["-d"], actual.bytes);
    assert.equal(decoded.status, 0);
    assert.deepEqual(decoded.stdout, Buffer.from(allBytes));
  }
  const encoded = (await run(name, ["-w0"], "foobar")).stdout;
  const input = Buffer.from(` \t!${encoded}\r\n`);
  assert.deepEqual((await run(name, ["-di"], input)).bytes, native(executable, ["-di"], input).stdout);
});

test("native Vim xxd: exact format and reverse matrix", async context => {
  const version = native("xxd", ["-v"]);
  if (version.error) { context.skip("xxd not installed; static format tests still run"); return; }
  context.diagnostic(`${platform()} ${release()} ${arch()}; ${Buffer.concat([version.stdout, version.stderr]).toString().trim()}`);
  for (const args of [[], ["-p"], ["-p", "-c0"], ["-u"], ["-c3", "-g1"], ["-c31", "-g4"], ["-c256", "-g0"], ["-s2", "-l17", "-o8"], ["-d", "-s2", "-l17"]]) {
    const expected = native("xxd", args, allBytes);
    const actual = await run("xxd", args, allBytes);
    assert.equal(expected.status, 0);
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(actual.bytes, expected.stdout, args.join(" "));
  }
  for (const args of [[], ["-p"], ["-c3"]]) {
    const encoded = native("xxd", args, allBytes).stdout;
    const expected = native("xxd", ["-r", ...args], encoded);
    assert.deepEqual((await run("xxd", ["-r", ...args], encoded)).bytes, expected.stdout);
  }
});

test("native od: single-format matrix (GNU exact, BSD field-normalized)", async context => {
  const executable = native("god", ["--version"]).status === 0 ? "god" : "/usr/bin/od";
  const probe = native(executable, ["-An", "-tx1"]);
  if (probe.error) { context.skip("od not installed; static od tests still run"); return; }
  const version = native(executable, ["--version"]);
  const identity = version.status === 0 ? version.stdout.toString().split("\n")[0]
    : `${executable} (system BSD; no version flag), sha256=${createHash("sha256").update(readFileSync(executable)).digest("hex")}`;
  context.diagnostic(`${platform()} ${release()} ${arch()}; ${identity}`);
  if (version.status !== 0) context.diagnostic("BSD comparison normalizes whitespace, adjoining signed fields, and one extra leading zero in seven-digit hexadecimal addresses; not GNU byte-exact evidence");
  for (const args of [["-An", "-tx1"], ["-An", "-tu1"], ["-An", "-to1"], ["-An", "-td1"], ["-An", "-c"], ["-Ax", "-tx2"], ["-Ad", "-j3", "-N19", "-b"], []]) {
    const expected = native(executable, args, allBytes);
    assert.equal(expected.status, 0, expected.stderr.toString());
    const actual = (await run("od", args, allBytes)).bytes;
    if (version.status === 0) assert.deepEqual(actual, expected.stdout, args.join(" "));
    else assert.equal(normalizeBsdOd(actual, args.includes("-Ax")), normalizeBsdOd(expected.stdout, args.includes("-Ax")), args.join(" "));
  }
});
