import assert from "node:assert/strict";
import test from "node:test";

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
