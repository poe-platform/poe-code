import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";
const encoder = new TextEncoder();
async function parity(from: "json" | "rtf" | "csv" | "tsv", size = 8, script?: string, template = false, files = true) {
  const fs = new MemoryFileSystem(); await fs.mkdir("/spill"); await fs.mkdir("/docs");
  const picture = new Uint8Array(size); picture.set([137,80,78,71,13,10,26,10].slice(0, size)); await fs.writeFile("/docs/x.png", picture);
  const source = from === "rtf" ? String.raw`{\rtf1 before{\pict\pngblip ` + [...picture].map(byte => byte.toString(16).padStart(2, "0")).join("") + "}after}" : from === "json" ? JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["", [], []], [{t: "Str", c: "caption"}], ["x.png", "title"]]}]}]}) : "name\nvalue";
  const input = {bytes: encoder.encode(source), base: "/docs"};
  const options = {from, to: "html", embedResources: true, ...(script ? {filters: [{kind: "lua" as const, path: "/filter.lua"}]} : {}), ...(template ? {template: {bytes: encoder.encode("<custom>$body$</custom>")}} : {})};
  const filters = script ? {filters: createLuaFilterCapability({readStream: () => [encoder.encode(script)]})} : {};
  const capabilities = {...filters, ...(files ? {resourceFiles: fs, resourceCwd: "/wrong"} : {})};
  const expected = await convert([input], options, capabilities).catch(error => error);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file read forbidden"));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  let text = "", actual: unknown;
  try {
    const result = await convertToOutput([input], options, {...capabilities, workingFiles: {fs, directory: "/spill", cacheBytes: 16384}, output: {
      async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); text += new TextDecoder().decode(bytes);},
      async close() {expect(await fs.readdir("/spill")).toEqual([]);}, async abort() {}
    }});
    actual = {text, diagnostics: result.diagnostics};
  } catch (error) {actual = error;}
  finally {const calls = acquire.mock.calls.length; acquire.mockRestore(); expect(calls).toBe(0);}
  expect(await fs.readdir("/spill")).toEqual([]);
  if (expected instanceof Error) expect(actual).toMatchObject({message: expected.message, code: (expected as Error & {code: string}).code});
  else expect(actual).toEqual({text: expected.text, diagnostics: expected.diagnostics});
}
it.each(["json", "rtf"] as const)("streams embedded %s images into standalone HTML", async from => {await parity(from);});
it.each(["json", "rtf"] as const)("preserves %s embedded-image origins through Lua and templates", async from => {
  await parity(from, 8, "function Image(el) return el end", true);
});
it.each(["json", "rtf"] as const)("preserves embedded %s HTML without an external resource filesystem", async from => {await parity(from, 8, undefined, false, false);});
it("streams embedded picture encoding across base64 and storage boundaries", async () => {await parity("rtf", 65537);});

it.each([0, 1, 2, 3, 12287, 12288, 12289])("preserves embedded HTML MIME and padding for %i source bytes", async size => {await parity("json", size);});

it.each(["csv", "tsv"] as const)("preserves standalone HTML embedding options for delimited %s", async from => {await parity(from);});
