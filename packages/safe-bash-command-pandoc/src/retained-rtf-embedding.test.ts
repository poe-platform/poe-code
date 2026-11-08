import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";
const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
const jpeg = new Uint8Array([255,216,...segment(219,[0,...Array<number>(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array<number>(15).fill(0),0,16,1,...Array<number>(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
const picture = String.raw`{\pict\jpegblip ` + [...jpeg].map(byte => byte.toString(16).padStart(2, "0")).join("") + "}";
const encoder = new TextEncoder();
async function parity(to: string, content: string, script?: string, authority: "fs" | "resolver" | "none" = "fs") {
  const input = {bytes: encoder.encode(String.raw`{\rtf1 ` + content + "}")}, fs = new MemoryFileSystem();
  const options = {from: "rtf", to, ...(script ? {filters: [{kind: "lua" as const, path: "/filter.lua"}]} : {})};
  const filters = script ? {filters: createLuaFilterCapability({readStream: () => [encoder.encode(script)]})} : {};
  const resolve = vi.fn(async (): Promise<Uint8Array> => {throw new Error("Parser-owned resource reached external resolver");});
  const capabilities = authority === "resolver" ? {resources: {resolve}} : authority === "fs" ? {resourceFiles: fs} : {};
  const expected = await convert([input], options, {...filters, ...capabilities}).catch(error => error);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file read forbidden"));
  const collect = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole-input collection forbidden"));
  const output: number[] = []; let actual: unknown;
  try {
    const result = await convertToOutput([input], options, {...filters, ...capabilities, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {output.push(...bytes);}, async close() {expect(await fs.readdir("/")).toEqual([]);}, async abort() {}
    }});
    actual = {bytes: Uint8Array.from(output), diagnostics: result.diagnostics};
  } catch (error) {actual = error;}
  finally {const calls = collect.mock.calls.length; collect.mockRestore(); expect(calls).toBe(0);}
  expect(await fs.readdir("/")).toEqual([]);
  expect(resolve).not.toHaveBeenCalled();
  if (expected instanceof Error) expect(actual).toMatchObject({message: expected.message, code: (expected as Error & {code: string}).code});
  else expect(actual).toEqual({bytes: expected.kind === "text" ? encoder.encode(expected.text) : expected.bytes, diagnostics: expected.diagnostics});
}
it.each(["rtf", "odt"])("streams parser-owned pictures into %s", async target => {
  await parity(target, "before" + picture + "after" + picture);
});
it.each(["rtf", "odt"])("preserves removed-resource behavior for %s", async target => {
  await parity(target, picture, "function Image() return {} end");
});
it.each(["rtf", "odt"])("reuses parser-owned pictures duplicated by Lua in %s", async target => {
  await parity(target, picture, "function Image(el) return {el,el} end");
});
it.each(["rtf", "odt"])("preserves invalid picture decoding in %s", async target => {
  await parity(target, String.raw`{\pict\jpegblip ffd8}`);
});

it.each(["rtf", "odt"])("prefers retained picture bytes over other resource authorities for %s", async target => {
  await parity(target, picture, undefined, "resolver");
  await parity(target, picture, undefined, "none");
});
it("preserves real JSON-filter diagnostics for parser-owned relative image targets", async () => {
  const {createJsonFilterCapability} = await import("./json-filters.js");
  const filters = createJsonFilterCapability({async run() {throw new Error("Unexpected invocation");}, async runStream() {throw new Error("Unexpected invocation");}});
  const input = {bytes: encoder.encode(String.raw`{\rtf1 ` + picture + "}")}, options = {from: "rtf", to: "plain", filters: [{kind: "json" as const, path: "/filter"}]};
  const expected = await convert([input], options, {filters}).catch(error => error);
  const fs = new MemoryFileSystem(), apply = vi.spyOn(filters, "apply").mockRejectedValue(new Error("Resident filter forbidden"));
  const actual = await convertToOutput([input], options, {filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => error);
  expect(actual).toMatchObject({code: expected.code, message: expected.message});
  expect(apply).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});
