import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { convert, readDocument, writeDocument } from "./engine.js";
import type { ResourceFileSystem } from "./types.js";

const encode = (s: string) => new TextEncoder().encode(s);
function files(entries: Record<string, string>) {
  const volume = Volume.fromJSON(entries);
  const readStream = vi.fn(async function* (path: string) { yield new Uint8Array(volume.readFileSync(path) as Buffer); });
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); });
  const fs: ResourceFileSystem = {
    lstat: async path => { const s = volume.lstatSync(path); return {type: s.isSymbolicLink() ? "symlink" : s.isDirectory() ? "directory" : "file"}; },
    readStream, writeFile,
    mkdir: async path => {volume.mkdirSync(path, {recursive: true});}
  };
  return {volume, fs, readStream, writeFile};
}
const options = {from: "commonmark", to: "html", extractMedia: "/media"};
it("resolves URI escapes once, dot segments, Unicode and suffixes with repeated references", async () => {
  const host = files({"/doc/a b.png": "space", "/doc/a%20b.png": "literal", "/doc/字.png": "unicode"});
  const result = await convert([{base: "/doc", bytes: encode("![a](a%20b.png?x#y) ![b](./sub/../a%2520b.png) ![c](字.png) ![d](a%20b.png#z)")}], options, {resourceFiles: host.fs});
  expect(result).toMatchObject({text: expect.stringContaining('src="/media/a%20b.png?x#y"')});
  expect(host.readStream.mock.calls.map(c => c[0])).toEqual(["/doc/a b.png", "/doc/a%20b.png", "/doc/字.png"]);
  expect(host.volume.readFileSync("/media/a%20b.png", "utf8")).toBe("literal");
  expect(host.volume.readFileSync("/media/a b.png", "utf8")).toBe("space");
});
it("preserves joined operand origins and separates duplicate basenames deterministically", async () => {
  const host = files({"/one/p.png": "one", "/two/p.png": "two"});
  const result = await convert([{source: "one.md", base: "/one", bytes: encode("![one](p.png)\n")}, {source: "two.md", base: "/two", bytes: encode("![two](p.png)\n")}], options, {resourceFiles: host.fs});
  expect(host.readStream.mock.calls.map(c => c[0])).toEqual(["/one/p.png", "/two/p.png"]);
  expect(result).toMatchObject({text: expect.stringContaining('src="/media/p-2.png"')});
  expect(host.volume.readFileSync("/media/p.png", "utf8")).toBe("one");
  expect(host.volume.readFileSync("/media/p-2.png", "utf8")).toBe("two");
});
it("does not inherit the first operand base for a later operand with no base", async () => {
  const host = files({"/one/p.png": "one", "/cwd/p.png": "cwd"});
  await convert([{base: "/one", bytes: encode("![one](p.png)\n")}, {bytes: encode("![cwd](p.png)\n")}], options, {resourceFiles: host.fs, resourceCwd: "/cwd"});
  expect(host.readStream.mock.calls.map(c => c[0])).toEqual(["/one/p.png", "/cwd/p.png"]);
});
it("preserves source directory through the SDK read/write document seam", async () => {
  const host = files({"/doc/p.png": "image"});
  const document = await readDocument({source: "doc.md", base: "/doc", bytes: encode("![x](p.png)")}, {from: "commonmark"}, {});
  await writeDocument(document, {to: "html", extractMedia: "/media"}, {resourceFiles: host.fs});
  expect(host.readStream.mock.calls.map(c => c[0])).toEqual(["/doc/p.png"]);
});
it("keeps embedded media keys literal and rejects ambiguous key collisions", async () => {
  const host = files({});
  const doc = {blocks: [{t: "Para" as const, c: [{t: "Image" as const, c: [["", [], []], [], ["a%20.png", ""]] as const}]}], metadata: {}, resources: [{id: "a%20.png", bytes: encode("embedded")}]};
  const result = await writeDocument(doc, {to: "html", extractMedia: "/media"}, {resourceFiles: host.fs});
  expect(result).toMatchObject({text: expect.stringContaining('src="/media/a%2520.png"')});
  expect(host.readStream).not.toHaveBeenCalled();
  expect(host.volume.readFileSync("/media/a%20.png", "utf8")).toBe("embedded");
  host.writeFile.mockClear();
  await expect(writeDocument({...doc, resources: [...doc.resources, {id: "a%20.png", bytes: encode("different")}]}, {to: "html", extractMedia: "/other"}, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_RESOURCE"});
  expect(host.writeFile).not.toHaveBeenCalled();
});
it("extracts admitted embedded media even when it has no image reference", async () => {
  const host = files({});
  await writeDocument({blocks: [], metadata: {}, resources: [{id: "nested/orphan.png", bytes: encode("orphan")}]}, {to: "html", extractMedia: "/media"}, {resourceFiles: host.fs});
  expect(host.volume.readFileSync("/media/orphan.png", "utf8")).toBe("orphan");
  expect(host.readStream).not.toHaveBeenCalled();
});
it.each(["dir/.", "dir/", "../secret", "dir/../secret"])("rejects unsafe embedded extraction key %s", async id => {
  const host = files({});
  const doc = {blocks: [{t: "Para" as const, c: [{t: "Image" as const, c: [["", [], []], [], [id, ""]] as const}]}], metadata: {}, resources: [{id, bytes: encode("x")}]};
  await expect(writeDocument(doc, {to: "html", extractMedia: "/media"}, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(host.writeFile).not.toHaveBeenCalled();
});
it("searches only explicit resource-path directories in order", async () => {
  const host = files({"/fallback/p.png": "ok"});
  await convert([{base: "/doc", bytes: encode("![x](p.png)")}], {...options, resourcePath: ["/missing", "/fallback"]}, {resourceFiles: host.fs});
  expect(host.readStream.mock.calls.map(c => c[0])).toEqual(["/fallback/p.png"]);
});
it.each(["https://example.test/p.png", "file:///etc/passwd", "data:image/png;base64,AAAA", "../secret.png", "%2e%2e/secret.png", "/secret.png", "~/.secret", "a%2fb.png", "a%5cb.png"])("denies %s without resource acquisition", async target => {
  const host = files({"/secret.png": "secret"});
  await expect(convert([{base: "/doc", bytes: encode(`![x](${target})`)}], options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(host.readStream).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled();
});
it("leaves raw links and text-only images unacquired", async () => {
  const host = files({});
  await convert([{bytes: encode("[link](https://example.test) ![image](missing.png)")}], {from: "commonmark", to: "html"}, {resourceFiles: host.fs});
  expect(host.readStream).not.toHaveBeenCalled();
});
it("validates later denied targets and extract symlinks before any acquisition", async () => {
  const host = files({"/doc/a.png": "a", "/outside/x": "x"});
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png) ![bad](../secret)")}], options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(host.readStream).not.toHaveBeenCalled();
  host.volume.symlinkSync("/outside", "/media");
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png)")}], options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(host.readStream).not.toHaveBeenCalled();
});
it("allocates collision names around existing media names and keeps completed nontransactional writes", async () => {
  const host = files({"/doc/a/p.png": "a", "/doc/b/p.png": "b", "/doc/p-2.png": "c"});
  host.writeFile.mockImplementation(async (path, bytes) => {
    if (path === "/media/p-2.png") throw new Error("original provider write failure");
    host.volume.writeFileSync(path, bytes);
  });
  await expect(convert([{base: "/doc", bytes: encode("![a](a/p.png) ![b](b/p.png) ![c](p-2.png)")}], options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_IO"});
  expect(host.volume.readFileSync("/media/p.png", "utf8")).toBe("a");
  expect(host.volume.existsSync("/media/p-2-2.png")).toBe(false);
});
it("diagnoses missing images strictly or explicitly lossy, without swallowing denial", async () => {
  const host = files({});
  const input = [{source: "doc.md", base: "/doc", bytes: encode("![x](missing.png)")}];
  await expect(convert(input, options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_RESOURCE", location: expect.stringContaining("doc.md")});
  const result = await convert(input, {...options, lossy: true}, {resourceFiles: host.fs});
  expect(result.diagnostics).toMatchObject([{code: "W_RESOURCE_MISSING", location: expect.stringContaining("doc.md")}]);
  await expect(convert([{bytes: encode("![x](../secret)")}], {...options, lossy: true}, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("preflights every destination, symlink and existing collision before writes", async () => {
  const host = files({"/doc/a.png": "a", "/doc/b.png": "b", "/media/b.png": "existing"});
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png) ![b](b.png)")}], options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_IO"});
  expect(host.writeFile).not.toHaveBeenCalled();
  host.volume.symlinkSync("/doc", "/alias");
  host.readStream.mockClear();
  await expect(convert([{base: "/alias", bytes: encode("![a](a.png)")}], options, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(host.readStream).not.toHaveBeenCalled();
});
it("rejects extract traversal and warning failures before mutations", async () => {
  const host = files({"/doc/a.png": "a"});
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png)")}], {...options, extractMedia: "/media/../escape"}, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_OPTION"});
  expect(host.readStream).not.toHaveBeenCalled();
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png) ![b](missing.png)")}], {...options, lossy: true, failIfWarnings: true}, {resourceFiles: host.fs})).rejects.toMatchObject({code: "E_WARNINGS"});
  expect(host.writeFile).not.toHaveBeenCalled();
});
it("bounds streaming bytes before retaining reused producer chunks and honors abort", async () => {
  const host = files({"/doc/a.png": "a"});
  host.fs.readStream = async function* () {const bytes = Uint8Array.of(1, 2); yield bytes; bytes.fill(3); yield bytes;};
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png)")}], options, {resourceFiles: host.fs, limits: {resourceBytes: 3}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(host.writeFile).not.toHaveBeenCalled();
  await convert([{base: "/doc", bytes: encode("![a](a.png)")}], options, {resourceFiles: host.fs, limits: {resourceBytes: 4}});
  expect(new Uint8Array(host.volume.readFileSync("/media/a.png") as Buffer)).toEqual(Uint8Array.of(1, 2, 3, 3));
  const controller = new AbortController();
  host.fs.readStream = async function* () {controller.abort(); yield Uint8Array.of(1);};
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png)")}], {...options, extractMedia: "/other"}, {resourceFiles: host.fs, signal: controller.signal})).rejects.toMatchObject({code: "E_CANCELLED"});
});
it("reports bounded VFS read refusals as resource limits", async () => {
  const host = files({"/doc/a.png": "large"});
  delete host.fs.readStream;
  host.fs.readFile = async (_path, options) => {
    if (options!.maxBytes! < 5) throw Object.assign(new Error("original VFS byte refusal"), {code: "EFBIG"});
    return encode("large");
  };
  await expect(convert([{base: "/doc", bytes: encode("![x](a.png)")}], options, {resourceFiles: host.fs, limits: {resourceBytes: 4}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(host.writeFile).not.toHaveBeenCalled();
});
it("settles abort during acquisition, closes the producer and observes its late rejection", async () => {
  const host = files({"/doc/a.png": "a"});
  const controller = new AbortController();
  let rejectLate!: (error: Error) => void;
  const cleanup = vi.fn(async () => ({done: true as const, value: undefined}));
  host.fs.readStream = () => ({[Symbol.asyncIterator]: () => ({
    next: async () => {controller.abort(); return await new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {rejectLate = reject;});},
    return: cleanup
  })});
  await expect(convert([{base: "/doc", bytes: encode("![a](a.png)")}], options, {resourceFiles: host.fs, signal: controller.signal})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(cleanup).toHaveBeenCalledOnce();
  expect(host.writeFile).not.toHaveBeenCalled();
  rejectLate(new Error("original late provider rejection"));
  await Promise.resolve();
});
it("preserves escaped Markdown punctuation as a single literal VFS filename", async () => {
  const host = files({"/doc/a(b).png": "punctuation"});
  const result = await convert([{base: "/doc", bytes: encode("![x](a\\(b\\).png)")}], options, {resourceFiles: host.fs});
  expect(host.readStream.mock.calls.map(c => c[0])).toEqual(["/doc/a(b).png"]);
  expect(result).toMatchObject({text: expect.stringContaining('src="/media/a(b).png"')});
});
