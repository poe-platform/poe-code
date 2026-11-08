import { expect, it } from "vitest";
import { Volume } from "memfs";
import { acquireImageModelInput } from "./image-model-input.js";
import { rasterPng, rasterGif } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { Image } from "./image-model.js";
import { DocumentBudget } from "./budget.js";
import { ResourceLimitError, CancellationError } from "./archive.js";

it.each(["garden.PNG", "garden.asset", "garden", "garden."])("preserves explicit VFS basename and suffix metadata %s", async filename => {
  const source = rasterPng(), fs = Volume.fromJSON({ ["/" + filename]: Buffer.from(source) });
  const image = await Image.from_file({ path: "/" + filename, capability: "garden" }, { ...textContext, binaryResolver: { capability: "garden", async *open(path) { yield new Uint8Array(fs.readFileSync(path) as Buffer); } } });
  expect(image.filename).toBe(filename); expect(image.ext).toBe(filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : ""); expect(image.content_type).toBe("image/png");
});
it("copies reused explicit stream fragments and closes cooperative failed acquisition", async () => {
  const source = rasterPng(), fragment = new Uint8Array(source.length); let closed = false, forwarded: AbortSignal | undefined;
  const image = await Image.from_file({ open(signal) { forwarded = signal; return { async *[Symbol.asyncIterator]() { try { fragment.set(source); yield fragment; fragment.fill(0); } finally { closed = true; } } }; } }, textContext);
  expect(image.blob).toEqual(source); expect(image.filename).toBe("image.png"); expect(forwarded).toBeInstanceOf(AbortSignal); expect(closed).toBe(true);
  closed = false; await expect(Image.from_file({ open() { return { async *[Symbol.asyncIterator]() { try { yield source; } finally { closed = true; } } }; } }, { ...textContext, budget: new DocumentBudget({ embeddedMediaBytes: 1 }, textContext.signal) })).rejects.toThrow(ResourceLimitError); expect(closed).toBe(true);
});
it("requires matching capability and refuses source accessors before invocation", async () => {
  await expect(Image.from_file({ path: "/garden.png", capability: "garden" })).rejects.toThrow(); let touched = false;
  const input = Object.defineProperty({}, "open", { get() { touched = true; throw new Error(); } }); await expect(Image.from_file(input as { open(signal: AbortSignal): AsyncIterable<Uint8Array> }, textContext)).rejects.toThrow(); expect(touched).toBe(false);
});
it("admits finite canonical base64 equivalent under existing media limits", async () => {
  const source = rasterPng(), admitted = await acquireImageModelInput({ kind: "bytes", base64: btoa(String.fromCharCode(...source)) }, textContext); expect(admitted.bytes).toEqual(source); expect(admitted.filename).toBeNull();
  await expect(acquireImageModelInput({ kind: "bytes", base64: btoa(String.fromCharCode(...source)) }, { ...textContext, budget: new DocumentBudget({ embeddedMediaBytes: 1 }, textContext.signal) })).rejects.toThrow(ResourceLimitError);
});
it("forwards cancellation and awaits cooperative iterator cleanup", async () => {
  const controller = new AbortController(); let closed = false;
  await expect(Image.from_file({ open(signal) { return { async *[Symbol.asyncIterator]() { try { expect(signal.aborted).toBe(false); controller.abort(new Error("stopped")); yield rasterPng(); } finally { await Promise.resolve(); closed = true; } } }; } }, { ...textContext, signal: controller.signal })).rejects.toThrow(CancellationError); expect(closed).toBe(true);
});
it("rejects primary file-factory transport descriptors rather than guessing overloads", async () => {
  const input = { kind: "bytes" as const, base64: btoa(String.fromCharCode(...rasterPng())) };
  await expect(Image.from_file(input as unknown as Uint8Array)).rejects.toThrow();
});
it("refuses recognized suffix mismatch while retaining unknown suffix byte authority", async () => {
  await expect(Image.from_file({ path: "/garden.jpg", capability: "garden" }, { ...textContext, binaryResolver: { capability: "garden", async *open() { yield rasterPng(); } } })).rejects.toThrow("signature");
});
it("bounds virtual path bytes before invoking the resolver", async () => {
  let opened = false;
  await expect(Image.from_file({path:"/" + "海".repeat(10) + ".png",capability:"garden"}, { ...textContext, limits: { ...textContext.limits, maxPathBytes: 16 }, binaryResolver: {capability:"garden",async *open() {opened = true; yield rasterPng();}}})).rejects.toThrow(ResourceLimitError); expect(opened).toBe(false);
});
it("retains a leading-dot filename final suffix", async () => {
  const fs = Volume.fromJSON({"/input/.PNG":Buffer.from(rasterPng()),"/other/.PNG":Buffer.from(rasterGif())}), context = { ...textContext, binaryResolver: {capability:"garden",async *open(path:string) {yield new Uint8Array(fs.readFileSync(path) as Buffer);}}};
  const image = await Image.from_file({path:"/input/.PNG",capability:"garden"},context); expect(image.filename).toBe(".PNG"); expect(image.ext).toBe("PNG");
});
it("rejects a leading-dot recognized suffix conflicting with GIF bytes", async () => {
  const fs = Volume.fromJSON({"/input/.PNG":Buffer.from(rasterGif())});
  await expect(Image.from_file({path:"/input/.PNG",capability:"garden"},{ ...textContext, binaryResolver: {capability:"garden",async *open(path:string) {yield new Uint8Array(fs.readFileSync(path) as Buffer);}}})).rejects.toThrow("signature");
});
it("registers cooperative cleanup before opening an explicit source", async () => {
  const registered: (() => Promise<void>)[] = []; let finalized = 0;
  const image = await Image.from_file({open() {expect(registered).toHaveLength(1);return{async *[Symbol.asyncIterator]() {try {yield rasterPng();}finally {finalized++;}}};}}, {...textContext,registerCleanup(cleanup) {registered.push(cleanup);}});
  expect(image.filename).toBe("image.png"); await Promise.all([registered[0]!(),registered[0]!()]); expect(finalized).toBe(1);
});
