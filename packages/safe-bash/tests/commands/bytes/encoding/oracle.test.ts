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

function normalizeBsdHexAddresses(bytes: Uint8Array): { rows: string[]; finalNewline: boolean } {
  const text = Buffer.from(bytes).toString();
  const finalNewline = text.endsWith("\n");
  const body = finalNewline ? text.slice(0, -1) : text;
  const rows =
    text === ""
      ? []
      : body.split("\n").map((row) => {
          const [address, ...data] = row.split(/[ \t]+/u).filter((field) => field !== "");
          if (address === undefined) return "";
          if (address === "*" && data.length === 0) return "*";
          assert.match(address, /^[0-9a-f]+$/iu, "Invalid BSD hexadecimal address");
          return [BigInt(`0x${address}`).toString(16), ...data].join(" ");
        });
  return { rows, finalNewline };
}

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
  const normalize = (bytes: Uint8Array): string => Buffer.from(bytes).toString().replace(/(?<=\d)-(?=\d)/gu, " -").trim().split(/\s+/u).join(" ");
  for (const args of [["-An", "-tx1"], ["-An", "-tu1"], ["-An", "-to1"], ["-An", "-td1"], ["-An", "-c"], ["-Ax", "-tx2"], ["-Ad", "-j3", "-N19", "-b"], []]) {
    const expected = native(executable, args, allBytes);
    assert.equal(expected.status, 0, expected.stderr.toString());
    const actual = (await run("od", args, allBytes)).bytes;
    if (version.status === 0) assert.deepEqual(actual, expected.stdout, args.join(" "));
    else if (args.includes("-Ax")) assert.deepEqual(normalizeBsdHexAddresses(actual), normalizeBsdHexAddresses(expected.stdout), args.join(" "));
    else assert.equal(normalize(actual), normalize(expected.stdout), args.join(" "));
  }
});

test("BSD HEX addresses: padding alone is equivalent across rows and final offset", () => {
  const actual = Buffer.from("00000a 0100 0302\n00000e 0504 0706\n000012\n");
  const expected = Buffer.from("000000a 0100 0302\n000000e 0504 0706\n0000012\n");
  assert.deepEqual(normalizeBsdHexAddresses(actual), normalizeBsdHexAddresses(expected));
});

test("BSD HEX addresses: retain rows, suppression and exact data tokens", () => {
  assert.deepEqual(normalizeBsdHexAddresses(Buffer.from(" 000000\t000a  00AF\n*\n000020\n")), {
    rows: ["0 000a 00AF", "*", "20"],
    finalNewline: true
  });
});

test("BSD HEX addresses: normalize without numeric precision loss", () => {
  const address = "ffffffffffffffffffffffff";
  assert.deepEqual(normalizeBsdHexAddresses(Buffer.from(`000${address}\n`)), {
    rows: [address],
    finalNewline: true
  });
});

for (const [name, changed] of [
  ["initial offset", "000001 0100 0302\n000004 0504 0706\n000008\n"],
  ["intermediate offset", "000000 0100 0302\n000005 0504 0706\n000008\n"],
  ["final offset", "000000 0100 0302\n000004 0504 0706\n000009\n"],
  ["data value", "000000 0100 0303\n000004 0504 0706\n000008\n"],
  ["data padding", "000000 0100 00302\n000004 0504 0706\n000008\n"],
  ["swapped rows", "000004 0504 0706\n000000 0100 0302\n000008\n"],
  ["split row", "000000 0100\n0302\n000004 0504 0706\n000008\n"],
  ["merged rows", "000000 0100 0302 000004 0504 0706\n000008\n"],
  ["missing final row", "000000 0100 0302\n000004 0504 0706\n"],
  ["duplicate final row", "000000 0100 0302\n000004 0504 0706\n000008\n000008\n"],
  ["suppression marker", "000000 0100 0302\n*\n000004 0504 0706\n000008\n"],
  ["missing final LF", "000000 0100 0302\n000004 0504 0706\n000008"],
  ["extra blank row", "000000 0100 0302\n000004 0504 0706\n000008\n\n"]
] as const) {
  test(`BSD HEX addresses: reject changed ${name}`, () => {
    const expected = Buffer.from("000000 0100 0302\n000004 0504 0706\n000008\n");
    assert.notDeepEqual(
      normalizeBsdHexAddresses(Buffer.from(changed)),
      normalizeBsdHexAddresses(expected)
    );
  });
}

test("BSD HEX addresses: preserve data letter case", () => {
  assert.notDeepEqual(
    normalizeBsdHexAddresses(Buffer.from("000000 03af\n000002\n")),
    normalizeBsdHexAddresses(Buffer.from("000000 03AF\n000002\n"))
  );
});

for (const address of [
  "00000g",
  "000001junk",
  "+000001",
  "-000001",
  "0x000001",
  "000001\r",
  "000001\u2028"
]) {
  test(`BSD HEX addresses: reject malformed address ${address}`, () => {
    assert.throws(() => normalizeBsdHexAddresses(Buffer.from(`${address} 0100\n000002\n`)));
    assert.throws(() => normalizeBsdHexAddresses(Buffer.from(`000000 0100\n${address}\n`)));
  });
}
