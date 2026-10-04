import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";
import {ExecutionContext} from "./execution.js";
const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
const picture = new Uint8Array([255,216,...segment(219,[0,...Array<number>(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array<number>(15).fill(0),0,16,1,...Array<number>(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
const image = (url: string) => ({t: "Image", c: [["", [], []], [], [url, ""]]});

it.each(["html5", "rtf", "odt"].flatMap(to => ["file", "data", "search", "intrinsic", "removed"].map(kind => ({to, kind}))))("retains $to $kind resource reference budgets", async ({to, kind}) => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/spill"); await fs.mkdir("/images"); await fs.writeFile("/images/p x.jpg", picture);
  const urls = kind === "data" ? Array<string>(2).fill("data:image/jpeg;base64," + btoa(String.fromCharCode(...picture))) : ["p%20x.jpg?one", "p%20x.jpg#two", "p%20x.jpg?one"];
  const input = {base: "/images", bytes: new TextEncoder().encode(["intrinsic", "removed"].includes(kind) ? String.raw`{\rtf1{\pict\jpegblip ` + [...picture].map(byte => byte.toString(16).padStart(2, "0")).join("") + "}}" : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: urls.map(image)}]}))};
  const options = {from: ["intrinsic", "removed"].includes(kind) ? "rtf" : "json", to, ...(kind === "removed" ? {filters: [{kind: "lua" as const, path: "/filter.lua"}]} : {}), ...(to === "html5" ? {embedResources: true} : {}), ...(kind === "search" ? {resourcePath: ["/missing", "/images"]} : {})};
  for (const outputBytes of [undefined, 0, 1000]) {
  let success = false;
  let required = 0;
  if (kind === "removed") {
    const original = ExecutionContext.prototype.charge;
    const charge = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
      const result = original.apply(this, args);
      if (args[0] === "references") required = Math.max(required, 2000000 - this.remaining("references"));
      return result;
    });
    try {await convert([input], options, {resourceFiles: fs, limits: {references: 2000000, ...(outputBytes === undefined ? {} : {outputBytes})}, filters: createLuaFilterCapability({readStream: () => [new TextEncoder().encode("function Image(el) return {} end")]})}).catch(() => {});}
    finally {charge.mockRestore();}
    expect(required).toBeGreaterThan(2);
  }
  for (const references of kind === "removed" ? [required - 2, required - 1, required, required + 1] : Array.from({length: 2000}, (_, index) => index)) {
    const capabilities = {...(kind === "removed" ? {filters: createLuaFilterCapability({readStream: () => [new TextEncoder().encode("function Image(el) return {} end")]})} : {}), resourceFiles: fs, limits: {references, ...(outputBytes === undefined ? {} : {outputBytes})}};
    const expected = await convert([input], options, capabilities).catch(error => error);
    const bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
    try {
      const actual = await convertToOutput([input], options, {...capabilities, workingFiles: {fs, directory: "/spill"}, output: {
        async write(chunk) {bytes.push(...chunk);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire.mock.calls.length, String(references)).toBe(0); expect(readFile).not.toHaveBeenCalled();
      if (expected instanceof Error) {
        expect(actual, String(references)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        expect(bytes).toEqual([]);
        if (outputBytes !== undefined && expected.message.startsWith("outputBytes:") || kind === "removed" && (expected as {code?: string}).code === "E_RESOURCE") success = true;
      } else {
        expect(actual, String(references)).not.toBeInstanceOf(Error);
        expect(actual.diagnostics).toEqual(expected.diagnostics);
        expect(Uint8Array.from(bytes)).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
        success = true;
      }
    } finally {acquire.mockRestore(); readFile.mockRestore();}
    expect(await fs.readdir("/spill")).toEqual([]);
    if (success) break;
  }
  expect(success).toBe(true);
  }
});

it.each(["html5", "rtf", "odt"].flatMap(to => ["file", "data", "png", "collision", "search", "resolver", ...(to === "html5" ? ["intrinsic"] : [])].map(kind => ({to, kind}))))("retains $to $kind resource byte budgets", async ({to, kind}) => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/spill"); await fs.mkdir("/images"); await fs.mkdir("/other");
  const bytes = kind === "png" ? Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg=="), c => c.charCodeAt(0)) : picture;
  await fs.writeFile("/images/p x.jpg", bytes); await fs.writeFile("/other/p x.jpg", bytes);
  const urls = kind === "data" ? Array<string>(2).fill("data:image/jpeg;base64," + btoa(String.fromCharCode(...bytes))) : kind === "collision" ? ["images/p%20x.jpg?one", "other/p%20x.jpg", "images/p%20x.jpg#two"] : ["p%20x.jpg?one", "p%20x.jpg#two", "p%20x.jpg?one"];
  const input = {base: kind === "collision" ? "/" : "/images", bytes: new TextEncoder().encode(kind === "intrinsic" ? String.raw`{\rtf1{\pict\jpegblip ` + [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("") + "}}" : JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: urls.map(image)}]}))};
  const resources = kind === "resolver" ? {async resolve() {return bytes;}} : undefined;
  const options = {from: kind === "intrinsic" ? "rtf" : "json", to, ...(to === "html5" ? {embedResources: true} : {}), ...(kind === "search" ? {resourcePath: ["/missing", "/images"]} : {})}, boundaries = new Set<number>([0, 1000000]), original = ExecutionContext.prototype.charge;
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (["retainedBytes", "expandedBytes", "binaryBytes"].includes(args[0])) {const used = 1000000-this.remaining("retainedBytes"); boundaries.add(used); boundaries.add(used-1);}
    return result;
  });
  try {await convert([input], options, {resourceFiles: fs, ...(resources ? {resources} : {}), limits: {retainedBytes: 1000000}, output: {async write() {}, async close() {}, async abort() {}}});}
  finally {trace.mockRestore();}
  const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
  for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length/48) === 0 || index >= values.length-64)) {
    const expectedBytes: number[] = [], actualBytes: number[] = [];
    const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
    const capabilities = {resourceFiles: fs, ...(resources ? {resources} : {}), limits: {retainedBytes}};
    const expected = await convert([input], options, {...capabilities, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
    try {
      const actual = await convertToOutput([input], options, {...capabilities, workingFiles: {fs, directory: "/spill"}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled(); expect(readFile).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes);
    } finally {acquire.mockRestore(); readFile.mockRestore();}
    expect(await fs.readdir("/spill")).toEqual([]);
  }
});
