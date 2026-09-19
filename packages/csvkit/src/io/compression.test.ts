import { test, expect } from "vitest";
import { createCompressionCodec } from "@poe-code/office-package/compression";
import { createGzipCompressionProvider } from "./compression.js";

const signal = new AbortController().signal;
async function gzip(text: string): Promise<Uint8Array> {
  const codec = createCompressionCodec();
  const reader = new codec.CodecReader((async function* () { yield new TextEncoder().encode(text); })(), signal);
  const bytes: number[] = [];
  try { for await (const chunk of codec.codec(reader, { mode: "gzip" }, signal)) bytes.push(...chunk); }
  finally { await reader.close(); }
  return Uint8Array.from(bytes);
}
async function decode(input: Uint8Array): Promise<string> {
  const provider = createGzipCompressionProvider(createCompressionCodec());
  const bytes: number[] = [];
  for await (const chunk of provider.decode((async function* () { yield input; })(), signal)) bytes.push(...chunk);
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

test("office-backed gzip provider decodes empty, concatenated and padded members", async () => {
  expect(await decode(new Uint8Array())).toBe("");
  const a = await gzip("a\n"), b = await gzip("b\n");
  expect(await decode(Uint8Array.from([...a, 0, 0, ...b, 0]))).toBe("a\nb\n");
});

test("office-backed gzip provider explicitly blocks unqualified corrupt and truncated diagnostics", async () => {
  const member = await gzip("a\n");
  for (const bytes of [member.subarray(0, member.length - 1), Uint8Array.of(1, 2), Uint8Array.from([...member, 0, 1, 2])])
    await expect(decode(bytes)).rejects.toThrow("unsupported or unqualified: gzip codec diagnostic");
});

test("gzip provider preserves falsey source failures and closes owned sources once", async () => {
  for (const failure of [undefined, null, false, 0]) {
    let closed = 0;
    const provider = createGzipCompressionProvider(createCompressionCodec());
    const source = (async function* () { try { yield Uint8Array.of(31); throw failure; } finally { closed++; } })();
    let caught = false, reason: unknown;
    try { for await (const chunk of provider.decode(source, signal)) void chunk; }
    catch (error) { caught = true; reason = error; }
    expect(caught).toBe(true);
    expect(reason).toBe(failure);
    expect(closed).toBe(1);
  }
});

test("gzip provider enforces aggregate member admission before publishing a member", async () => {
  const a = await gzip("a\n"), b = await gzip("b\n");
  const provider = createGzipCompressionProvider(createCompressionCodec());
  const source = (async function* () { yield Uint8Array.from([...a, ...b]); })();
  const output: number[] = [];
  await expect(async () => {
    for await (const chunk of provider.decode(source, signal, { maxArchiveMembers: 1 })) output.push(...chunk);
  }).rejects.toThrow("gzip member budget exceeded");
  expect(new TextDecoder().decode(Uint8Array.from(output))).toBe("a\n");
});
