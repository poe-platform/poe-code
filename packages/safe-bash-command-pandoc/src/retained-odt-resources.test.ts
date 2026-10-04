import {createJsonFilterCapability} from "./json-filters.js";
import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {Volume} from "memfs";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionContext, ConversionOptions, ResourceFileSystem} from "./types.js";
const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
const picture = new Uint8Array([255,216,...segment(219,[0,...Array<number>(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array<number>(15).fill(0),0,16,1,...Array<number>(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
const image = (url: string) => ({t: "Image", c: [["", [], []], [], [url, ""]]});
function host(bytes: Uint8Array = picture) {
  const volume = Volume.fromJSON({"/doc/p x.jpg": "", "/cwd/fallback.jpg": ""});
  volume.writeFileSync("/doc/p x.jpg", bytes); volume.writeFileSync("/cwd/fallback.jpg", bytes);
  volume.symlinkSync("p x.jpg", "/doc/link.jpg");
  const readFile = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Uint8Array));
  const readStream = vi.fn(async function* (path: string) {
    const bytes = volume.readFileSync(path) as Uint8Array, reused = new Uint8Array(7);
    for (let i = 0; i < bytes.length; i += 7) {reused.fill(0); reused.set(bytes.subarray(i, i + 7)); yield reused.subarray(0, Math.min(7, bytes.length-i));}
  });
  const fs: ResourceFileSystem = {readFile, readStream, async mkdir() {}, async writeFile() {}, async lstat(path) {
    const stat = volume.lstatSync(path); return {type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file"};
  }};
  return {fs, readFile, readStream};
}
async function parity(urls: string[], lossy = false, metadata = false, extra: ConversionContext = {}, additional: Partial<ConversionOptions> = {}, bytes: Uint8Array = picture) {
  const input = {source: "source.json", base: "/doc", bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: metadata ? {images: {t: "MetaInlines", c: urls.map(image)}} : {}, blocks: metadata ? [] : [{t: "Para", c: urls.map(image)}]}))};
  const expectedHost = host(bytes), actualHost = host(bytes), options = {from: "json", to: "odt", lossy, ...additional};
  const expected = await convert([input], options, {resourceFiles: expectedHost.fs, resourceCwd: "/cwd", ...extra}).catch(error => error);
  const fs = new MemoryFileSystem(), close = vi.fn(async () => {}), abort = vi.fn(async () => {}); const output: Uint8Array[] = [];
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
  let actual: unknown;
  try {
    actual = await convertToOutput([input], options, {resourceFiles: actualHost.fs, resourceCwd: "/cwd", ...extra, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {await Promise.resolve(); output.push(bytes.slice());}, close, abort}}).then(summary => ({bytes: Uint8Array.from(output.flatMap(chunk => [...chunk])), diagnostics: summary.diagnostics})).catch(error => error);
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(actualHost.readFile).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
  if (expected instanceof Error) {expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message}); expect(close).not.toHaveBeenCalled();}
  else {expect(actual).toEqual({bytes: expected.bytes, diagnostics: expected.diagnostics}); expect(close).toHaveBeenCalledOnce();}
  return {...actualHost, actual, expected};
}
it("streams reused image chunks and deduplicates decoded paths with cwd fallback", async () => {
  const result = await parity(["p%20x.jpg?one", "p%20x.jpg#two", "fallback.jpg"]);
  expect(result.readStream.mock.calls.map(call => call[0])).toEqual(["/doc/p x.jpg", "/cwd/fallback.jpg"]);
});
it.each(["../p.jpg", "/p.jpg", "https://example.test/p.jpg", "p%2Fq.jpg", "p%00.jpg", "link.jpg", "missing.jpg"])("preserves resource admission for %s", async url => {await parity([url]);});
it("preserves lossy and metadata missing-resource diagnostics", async () => {await parity(["missing.jpg"], true); await parity(["missing.jpg"], true, true);});
it("preserves data URI decoding and repeated embedded images", async () => {
  const encoded = btoa(String.fromCharCode(...picture));
  for (const value of [encoded, encoded.replaceAll("=", ""), encoded.slice(0, 8) + " \n" + encoded.slice(8), encoded + "!", "A", "AA=A"]) await parity(["data:image/jpeg;base64," + value, "data:image/jpeg;base64," + value]);
});
it("preserves explicit resource resolvers", async () => {await parity(["opaque://picture"], false, false, {resources: {async resolve() {return picture;}}});});

it.each(["source", "cancel", "sink"])("cleans up streamed pictures on %s failure", async mode => {
  const resources = host(), fs = new MemoryFileSystem(), controller = new AbortController();
  const input = {base: "/doc", bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [image("p%20x.jpg")]}]}))};
  const original = resources.readStream.getMockImplementation()!;
  resources.readStream.mockImplementation(async function* (path) {
    let count = 0;
    for await (const chunk of original(path)) {
      if (++count === 3 && mode !== "sink") {if (mode === "cancel") controller.abort(); else throw new Error("Resource failed");}
      yield chunk;
    }
  });
  const close = vi.fn(async () => {});
  await expect(convertToOutput([input], {from: "json", to: "odt"}, {resourceFiles: resources.fs, signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {if (mode === "sink") throw new Error("Sink failed");}, close, async abort() {}}})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(close).not.toHaveBeenCalled(); expect(resources.readFile).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});

it("spools a data URI larger than scalar and resource buffers", async () => {
  const header = segment(224, [74,70,73,70,0,1,1,0,0,1,0,1,0,0, ...Array<number>(50000).fill(0)]);
  const large = new Uint8Array([...picture.subarray(0,2), ...header, ...picture.subarray(2)]);
  const url = "data:image/jpeg;base64," + btoa(String.fromCharCode(...large));
  const result = await parity([url, url]);
  expect(result.expected).not.toBeInstanceOf(Error); expect(result.readStream).not.toHaveBeenCalled();
});

it("streams ordered resource search directories without acquiring the document", async () => {
  const result = await parity(["fallback.jpg", "p%20x.jpg"], false, false, {}, {resourcePath: ["/missing", "/cwd", "/doc"]});
  expect(result.expected).not.toBeInstanceOf(Error);
  expect(result.readStream.mock.calls.map(call => call[0])).toEqual(["/cwd/fallback.jpg", "/doc/p x.jpg"]);
});
it("preserves explicit empty and relative resource search paths", async () => {
  await parity(["p%20x.jpg"], false, false, {}, {resourcePath: []});
  const result = await parity(["fallback.jpg"], false, false, {}, {resourcePath: ["."]});
  expect(result.expected).not.toBeInstanceOf(Error);
  expect(result.readStream.mock.calls.map(call => call[0])).toEqual(["/cwd/fallback.jpg"]);
});

it.each([null, "directory", [null], ["../escape"]])("preserves malformed resourcePath admission: %j", async value => {
  await parity(["fallback.jpg"], false, false, {}, {resourcePath: value as unknown as string[]});
});
it("rejects retained metadata resource warnings before output when requested", async () => {
  await parity(["missing.jpg"], true, true, {}, {failIfWarnings: true});
});

it("preserves streamed PNG/GIF/BMP/TIFF packaging and physical dimensions", async () => {
  for (const bytes of [
    // Fixed PNG (10x20, asymmetric density), GIF, BMP and both TIFF byte orders.
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAUCAYAAAC07qxWAAAACXBIWXMAAAZ2AAADsQGrVuziAAAAEElEQVR4AQEFAPr/AAAAAAAABQABZHiVOAAAAABJRU5ErkJggg==",
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs=",
    "Qk06AAAAAAAAADYAAAAoAAAAAQAAAP////8BABgAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAHlp4AA==",
    "SUkqAAgAAAAFAAABBAABAAAAAQAAAAEBBAABAAAAAQAAABoBBQABAAAASgAAABsBBQABAAAAUgAAACgBAwABAAAAAgAAAAAAAACQAAAAAQAAAEgAAAABAAAAUA==",
    "TU0AKgAAAAgABQEAAAQAAAABAAAAAQEBAAQAAAABAAAAAQEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAAAAAAAAAACQAAAAAQAAAEgAAAABUA=="
  ].map(value => Uint8Array.from(atob(value), character => character.charCodeAt(0)))) {
    const result = await parity(["p%20x.jpg", "p%20x.jpg"], false, false, {}, {}, bytes);
    expect(result.expected).not.toBeInstanceOf(Error); expect(result.readStream).toHaveBeenCalledOnce();
  }
});

it("resolves newly filtered image targets from resourceCwd rather than the original input base", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [image("p%20x.jpg")]}]}));
  const run = async ({stdout}: {stdout: {write(bytes: Uint8Array): Promise<void>}}) => {await stdout.write(bytes); return 0;};
  const filters = createJsonFilterCapability({run, runStream: run});
  await parity([],false,false,{filters},{filters:[{kind:"json",path:"add-image"}]});
});
