import {expect, it, vi} from "vitest";
import {ExecutionContext} from "./execution.js";
import {decodeRtfText} from "./rtf-text.js";
import {rtfReader} from "./rtf.js";

it("decodes long adjacent RTF byte runs through bounded windows", async () => {
  const context = new ExecutionContext("read", {yield: async () => {}}), decode = vi.spyOn(context, "decodeCodepage");
  try {
    const source = String.raw`{\rtf1 ` + (String.raw`ab\'e9`).repeat(3000) + "}";
    const result = await rtfReader.read({bytes: new TextEncoder().encode(source)}, context);
    expect(result.blocks).toEqual([{t: "Para", c: [{t: "Str", c: "abé".repeat(3000)}]}]);
    expect(Math.max(...decode.mock.calls.map(([bytes]) => bytes.length))).toBeLessThanOrEqual(2048);
  } finally {await context.close();}
});
it("retains UTF-8 sequences split between raw and escaped bytes at decoder windows", async () => {
  const context = new ExecutionContext("read", {yield: async () => {}});
  try {
    const source = String.raw`{\rtf1\ansicpg65001 ` + "a".repeat(255) + String.raw`\'f0\'9f\'98\'80` + "b".repeat(256) + "}";
    const result = await rtfReader.read({bytes: new TextEncoder().encode(source)}, context);
    expect(result.blocks).toEqual([{t: "Para", c: [{t: "Str", c: "a".repeat(255) + "😀" + "b".repeat(256)}]}]);
  } finally {await context.close();}
});

it.each(["malformed", "truncated", "symbol"])("preserves %s UTF-8 run errors and retires its source", async mode => {
  const context = new ExecutionContext("read", {}); let retired = false;
  const source = (async function* () {
    try {
      yield Uint8Array.of(mode === "malformed" ? 255 : 195);
      if (mode === "symbol") {yield "{"; yield Uint8Array.of(169);}
    } finally {retired = true;}
  })();
  try {
    const read = async () => {for await (const chunk of decodeRtfText(source, 65001, context)) void chunk;};
    await expect(read()).rejects.toMatchObject({code: "E_ENCODING", message: mode === "malformed" ? "Invalid RTF bytes for code page 65001" : "Truncated RTF code-page sequence 65001"});
    expect(retired).toBe(true);
  } finally {await context.close();}
});
it("preserves codepage bytes, literal symbols, and BOMs across reused source buffers", async () => {
  for (const page of [1252, 65001]) {
    const context = new ExecutionContext("read", {});
    const bytes = page === 1252 ? Uint8Array.from({length: 256}, (_, index) => index) : new TextEncoder().encode("\ufeffé😀");
    const expected = page === 1252 ? await context.decodeCodepage(bytes) : "\ufeffé😀";
    try {
      let text = "";
      const source = (async function* () {const part = new Uint8Array(1); for (const value of bytes) {part[0] = value; yield part;} yield "{"; for (const value of bytes) {part[0] = value; yield part;}})();
      for await (const part of decodeRtfText(source, page, context)) text += part;
      expect(text).toBe(expected + "{" + expected);
    } finally {await context.close();}
  }
});
it("keeps text budgets and closes a producer when decoding exceeds them", async () => {
  const context = new ExecutionContext("read", {limits: {text: 10}}); let retired = false;
  try {
    const source = (async function* () {try {yield new Uint8Array(8192).fill(97);} finally {retired = true;}})();
    const read = async () => {for await (const chunk of decodeRtfText(source, 1252, context)) void chunk;};
    await expect(read()).rejects.toMatchObject({code: "E_LIMIT"}); expect(retired).toBe(true);
  } finally {await context.close();}
});
