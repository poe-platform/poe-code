import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./helpers.js";

for (const [encoding, hex, text] of [
  ["windows-1252", "936869940a", "“hi”\n"],
  ["cp1252", "936869940a", "“hi”\n"],
  ["iso-8859-15", "a40a", "€\n"],
  ["utf-32", "fffe000068000000690000000a000000", "hi\n"],
  ["shift_jis", "82a00a", "あ\n"],
  ["iso-8859-2", "a1b1a3b30a", "ĄąŁł\n"],
  ["euc-jp", "a4a28eb18fa2af0a", "あｱ˘\n"],
  ["utf-32le", "00f60100", "😀"],
  ["utf-32be", "0001f600", "😀"],
] as const) {
  test(`${encoding} decodes and encodes exact bytes`, async () => {
    const decoded = await run(["-f", encoding, "-t", "utf-8"], Buffer.from(hex, "hex"));
    assert.equal(decoded.exitCode, 0, Buffer.from(decoded.stderrHex, "hex").toString());
    assert.equal(decoded.stderrHex, "");
    assert.equal(decoded.stdoutHex, Buffer.from(text).toString("hex"));
    const encoded = await run(["-f", "utf-8", "-t", encoding], Buffer.from(text));
    assert.equal(encoded.exitCode, 0);
    assert.equal(encoded.stderrHex, "");
    assert.equal(encoded.stdoutHex, hex);
  });
}

for (const [encoding, hex, diagnostic] of [
  ["windows-1252", "81", "illegal input sequence"],
  ["shift_jis", "82", "incomplete character"],
  ["shift_jis", "8220", "illegal input sequence"],
  ["euc-jp", "8fa2", "incomplete character"],
  ["utf-32le", "00001100", "illegal input sequence"],
  ["utf-32be", "0000d800", "illegal input sequence"],
  ["utf-32", "fffe00004100", "incomplete character"],
] as const) test(`${encoding} rejects ${hex}`, async () => {
  const result = await run(["-f", encoding, "-t", "utf-8"], Buffer.from(hex, "hex"));
  assert.equal(result.exitCode, 1);
  assert.ok(Buffer.from(result.stderrHex, "hex").toString().includes(diagnostic));
});

test("UTF-32 consumes a big-endian BOM", async () => {
  const result = await run(["-f", "utf-32", "-t", "utf-8"], Buffer.from("0000feff00000041", "hex"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutHex, "41");
});

test("legacy invalid bytes can be discarded without losing following text", async () => {
  for (const [encoding, hex] of [["windows-1252", "8141"], ["shift_jis", "8241"], ["euc-jp", "ff41"]]) {
    const result = await run(["-c", "-f", encoding!, "-t", "utf-8"], Buffer.from(hex!, "hex"));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdoutHex, "41");
    assert.equal(result.stderrHex, "");
  }
});

test("UTF-32 output expansion obeys the output byte limit", async () => {
  const result = await run(["-f", "utf-8", "-t", "utf-32"], Buffer.from("hi"), { limits: { maxOutputBytes: 8 } });
  assert.equal(result.exitCode, 1);
  assert.ok(Buffer.from(result.stderrHex, "hex").toString().includes("output bytes limit"));
});
