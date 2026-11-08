import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { convert, writeDocument } from "./engine.js";
import type { ResourceFileSystem } from "./types.js";

const encode = (text: string) => new TextEncoder().encode(text);
const segment = (marker: number, data: readonly number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
function jpeg(positive = true): Uint8Array {
  return Uint8Array.from([255, 216,
    ...segment(219, [0, ...Array<number>(64).fill(16)]),
    ...segment(192, [8, 0, 1, 0, 8, 1, 1, 0x11, 0]),
    ...segment(196, [0, 1, ...Array<number>(15).fill(0), 1, 16, 1, ...Array<number>(15).fill(0), 0]),
    ...segment(218, [1, 1, 0, 0, 63, 0]), positive ? 0x5f : 0x1f, 255, 217]);
}
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
function files(entries: Record<string, Uint8Array>) {
  const volume = Volume.fromJSON(Object.fromEntries(Object.keys(entries).map(path => [path, ""])));
  for (const [path, bytes] of Object.entries(entries)) volume.writeFileSync(path, bytes);
  const readFile = vi.fn<NonNullable<ResourceFileSystem["readFile"]>>(async (path, options) => {
    const bytes = volume.readFileSync(path) as Uint8Array;
    if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) throw Object.assign(new Error("bounded read"), { code: "EFBIG" });
    return Uint8Array.from(bytes);
  });
  const mkdir = vi.fn< ResourceFileSystem["mkdir"]>(async path => { volume.mkdirSync(path, { recursive: true }); });
  const writeFile = vi.fn<ResourceFileSystem["writeFile"]>(async (path, bytes) => { volume.writeFileSync(path, bytes); });
  const fs: ResourceFileSystem = { readFile, mkdir, writeFile, lstat: async path => {
    const stat = volume.lstatSync(path);
    return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file" };
  } };
  return { volume, fs, readFile, mkdir, writeFile };
}
const input = (base: string, text = "![image](p.jpg)") => ({ base, bytes: encode(text) });
const options = { from: "commonmark", to: "rtf" };

it("embeds images from joined input origins without writing extraction files", async () => {
  const first = jpeg(), second = jpeg(false);
  const host = files({ "/one/p.jpg": first, "/two/p.jpg": second });
  const result = await convert([input("/one"), input("/two")], options, { resourceFiles: host.fs });
  expect(result).toMatchObject({ kind: "text", text: expect.stringContaining(hex(first)) });
  expect(result).toMatchObject({ text: expect.stringContaining(hex(second)) });
  expect(host.readFile.mock.calls.map(call => call[0])).toEqual(["/one/p.jpg", "/two/p.jpg"]);
  expect(host.mkdir).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled();
});

it("applies resourcePath and decodes URI components once before embedding", async () => {
  const bytes = jpeg(), host = files({ "/images/p x.jpg": bytes });
  const result = await convert([input("/else", "![image](p%20x.jpg?version#fragment)")], { ...options, resourcePath: ["/images"] }, { resourceFiles: host.fs });
  expect(result).toMatchObject({ text: expect.stringContaining(hex(bytes)) });
  expect(host.readFile.mock.calls.map(call => call[0])).toEqual(["/images/p x.jpg"]);
  expect(host.writeFile).not.toHaveBeenCalled();
});

it("uses resourceCwd for SDK documents without an input origin", async () => {
  const bytes = jpeg(), host = files({ "/cwd/p.jpg": bytes });
  const result = await writeDocument({ blocks: [{ t: "Para", c: [{ t: "Image", c: [["", [], []], [], ["p.jpg", ""]] }] }], metadata: {}, resources: [] }, { to: "rtf" }, { resourceFiles: host.fs, resourceCwd: "/cwd" });
  expect(result).toMatchObject({ text: expect.stringContaining(hex(bytes)) });
  expect(host.readFile.mock.calls[0]?.[0]).toBe("/cwd/p.jpg");
});

it.each(["../p.jpg", "/p.jpg", "https://example.test/p.jpg", "p%2Fq.jpg", "p%00.jpg"])("rejects forbidden image target %s before reads or publication", async target => {
  const host = files({ "/doc/p.jpg": jpeg() }), publish = vi.fn(async () => {});
  await expect(convert([input("/doc", `![image](${target})`)], options, { resourceFiles: host.fs, output: { publish } })).rejects.toMatchObject({ code: "E_CAPABILITY" });
  expect(host.readFile).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
});

it("refuses symlink pictures before reading bytes", async () => {
  const host = files({ "/doc/real.jpg": jpeg() }); host.volume.symlinkSync("real.jpg", "/doc/p.jpg");
  await expect(convert([input("/doc")], options, { resourceFiles: host.fs })).rejects.toMatchObject({ code: "E_CAPABILITY" });
  expect(host.readFile).not.toHaveBeenCalled();
});

it("enforces resource byte limits before publication", async () => {
  const bytes = jpeg(), host = files({ "/doc/p.jpg": bytes }), publish = vi.fn(async () => {});
  await expect(convert([input("/doc")], options, { resourceFiles: host.fs, limits: { resourceBytes: bytes.length - 1 }, output: { publish } })).rejects.toMatchObject({ code: "E_LIMIT" });
  expect(host.readFile.mock.calls[0]?.[1]?.maxBytes).toBe(bytes.length - 1);
  expect(publish).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled();
});

it("observes cancellation after a resource read without publishing", async () => {
  const bytes = jpeg(), host = files({ "/doc/p.jpg": bytes }), controller = new AbortController(), publish = vi.fn(async () => {});
  host.readFile.mockImplementationOnce(async () => { controller.abort(); return bytes; });
  await expect(convert([input("/doc")], options, { resourceFiles: host.fs, signal: controller.signal, output: { publish } })).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(publish).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled();
});

it("preserves an explicitly supplied resource resolver", async () => {
  const host = files({}), bytes = jpeg(), resolve = vi.fn(async () => bytes);
  expect(await convert([input("/doc")], options, { resourceFiles: host.fs, resources: { resolve } })).toMatchObject({ text: expect.stringContaining(hex(bytes)) });
  expect(resolve).toHaveBeenCalledOnce(); expect(host.readFile).not.toHaveBeenCalled();
});

it("supports explicitly requested extraction while embedding the same checked bytes", async () => {
  const bytes = jpeg(), host = files({ "/doc/p.jpg": bytes });
  expect(await convert([input("/doc")], { ...options, extractMedia: "/media" }, { resourceFiles: host.fs })).toMatchObject({ text: expect.stringContaining(hex(bytes)) });
  expect(Uint8Array.from(host.volume.readFileSync("/media/p.jpg") as Uint8Array)).toEqual(bytes);
  expect(host.writeFile).toHaveBeenCalledOnce();
});

// The VFS path must preserve the writer's existing embedded-resource checks.
it.each(["unreferenced", "duplicate"])("refuses %s embedded resources with a configured VFS", async kind => {
  const bytes = jpeg(), host = files({});
  const resource = { id: "p.jpg", bytes };
  const blocks = kind === "unreferenced" ? [] : [{ t: "Para" as const, c: [{ t: "Image" as const, c: [["", [], []], [], ["p.jpg", ""]] as const }] }];
  const resources = kind === "unreferenced" ? [resource] : [resource, resource];
  await expect(writeDocument({ blocks, metadata: {}, resources }, { to: "rtf" }, { resourceFiles: host.fs })).rejects.toMatchObject({ code: "E_RESOURCE" });
  expect(host.readFile).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled();
});

it.each(["https://example.test/p.jpg", "/picture.jpg", "nested/", "p%20x.jpg"])("preserves opaque embedded resource key %s without extraction", async id => {
  const bytes = jpeg(), host = files({});
  const blocks = [{ t: "Para" as const, c: [{ t: "Image" as const, c: [["", [], []], [], [id, ""]] as const }] }];
  expect(await writeDocument({ blocks, metadata: {}, resources: [{ id, bytes }] }, { to: "rtf" }, { resourceFiles: host.fs })).toMatchObject({ text: expect.stringContaining(hex(bytes)) });
  expect(host.readFile).not.toHaveBeenCalled(); expect(host.writeFile).not.toHaveBeenCalled();
});
