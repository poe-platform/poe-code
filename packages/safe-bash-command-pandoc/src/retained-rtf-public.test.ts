import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";
import type {ConversionOptions} from "./types.js";
const encode = (value: string) => new TextEncoder().encode(value);
async function parity(source: string, to: string, script?: string) {
  const input = {bytes: encode(source)}, fs = new MemoryFileSystem();
  const options: ConversionOptions = {from: "rtf", to, ...(script ? {filters: [{kind: "lua", path: "/filter.lua"}]} : {})};
  const filters = script ? createLuaFilterCapability({readStream: () => [encode(script)]}) : undefined;
  const expected = await convert([input], options, {...(filters ? {filters} : {})}).catch(error => error);
  const collect = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole-input collector forbidden"));
  let text = "", actual: unknown;
  try {
    const result = await convertToOutput([input], options, {...(filters ? {filters} : {}), workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {expect(await fs.readdir("/")).toEqual([]);}, async abort() {}}});
    actual = {text, diagnostics: result.diagnostics};
  } catch (error) {actual = error;}
  finally {const calls = collect.mock.calls.length; collect.mockRestore(); expect(calls).toBe(0);}
  expect(await fs.readdir("/")).toEqual([]);
  if (expected instanceof Error) expect(actual).toMatchObject({message: expected.message, code: (expected as Error & {code: string}).code});
  else expect(actual).toMatchObject({text: expected.text, diagnostics: expected.diagnostics});
}
it.each(["json", "plain", "html", "commonmark", "gfm", "rst", "latex"])("streams RTF to %s without collecting the source", async target => {
  await parity(String.raw`{\rtf1 text{\b bold}\par{\footnote note}}`, target);
  await parity(String.raw`{\rtf1 before{\pict\pngblip 89504e470d0a1a0a}after}`, target);
});
it("runs a real Lua filter over caller-backed RTF", async () => {
  await parity(String.raw`{\rtf1 text{\b bold}}`, "json", "function Str(el) el.text = string.upper(el.text); return el end");
});
it("keeps resource sidecars when a Lua filter removes their image nodes", async () => {
  await parity(String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}}`, "json", "function Image() return {} end");
});
