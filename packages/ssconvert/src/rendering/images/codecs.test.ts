import { expect, it } from "vitest";
import { decode } from "jpeg-js";
import { encodeGraphImage, type ImageSurface } from "./codecs.js";
import type { CapabilityContext } from "../../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 } };
const surface: ImageSurface = { width: 71, height: 35, commands: [], raster: { width: 98, height: 48, rgba: new Uint8Array(98 * 48 * 4) } };
it("encodes real RGBA PNG data with the measured native empty graph geometry", async () => {
  const bytes = await encodeGraphImage(surface, "png", context);
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([view.getUint32(16), view.getUint32(20), bytes[24], bytes[25]]).toEqual([98, 48, 8, 6]);
  let offset = 8;
  const compressed: Uint8Array<ArrayBuffer>[] = [];
  while (offset < bytes.length) {
    const count = view.getUint32(offset);
    if (new TextDecoder().decode(bytes.slice(offset + 4, offset + 8)) === "IDAT") compressed.push(bytes.slice(offset + 8, offset + 8 + count));
    offset += count + 12;
  }
  const raw = new Uint8Array(await new Response(new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  expect(raw.length).toBe((98 * 4 + 1) * 48);
  expect(raw.every(byte => byte === 0)).toBe(true);
});
it("JPEG composites transparent pixels onto white and uses genuine JPEG encoding", async () => {
  const bytes = await encodeGraphImage(surface, "jpeg", context);
  expect([...bytes.slice(0, 2)]).toEqual([255, 216]);
  const decoded = decode(bytes, { useTArray: true, tolerantDecoding: false });
  expect([decoded.width, decoded.height]).toEqual([98, 48]);
  expect(decoded.data.every(byte => byte === 255)).toBe(true);
});
it.each(["svg", "pdf", "ps", "eps"])("encodes a real %s vector target with point geometry", async format => {
  const text = new TextDecoder().decode(await encodeGraphImage(surface, format, context));
  if (format === "svg") expect(text).toContain('width="71" height="35" viewBox="0 0 71 35"');
  else if (format === "pdf") { expect(text.startsWith("%PDF-1.7")).toBe(true); expect(text).toContain("/MediaBox [0 0 71 35]"); expect(text).toContain("startxref"); }
  else { expect(text.startsWith(format === "eps" ? "%!PS-Adobe-3.0 EPSF-3.0" : "%!PS-Adobe-3.0\n")).toBe(true); expect(text).toContain("%%PageMedia: 71x35"); }
});
it.each(["ps", "eps"])("preserves native empty ink bounding boxes in %s", async format => {
  const text = new TextDecoder().decode(await encodeGraphImage(surface, format, context));
  expect(text).toContain("%%BoundingBox: 0 35 0 35\n");
  expect(text).toContain("%%PageBoundingBox: 0 35 0 35\n");
});
it.each(["emf", "wmf", "gif", "tga", "pnm", "bad", "jpg", "PNG"])("does not encode an alternative type for unsupported image ID %s", async format => {
  await expect(encodeGraphImage(surface, format, context)).rejects.toThrow(["emf", "wmf", "gif", "tga", "pnm"].includes(format) ? "Unknown failure while saving image" : "Unknown image format");
});
it.each(["bmp", "ico", "tiff"])("encodes genuine profile-registered %s raster bytes with white composition", async format => {
  const bytes = await encodeGraphImage({ width: 2, height: 1, commands: [], raster: {
    width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0])
  } }, format, context);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "bmp") {
    expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe("BM");
    expect([view.getInt32(18, true), view.getInt32(22, true), view.getUint16(28, true)]).toEqual([2, 1, 24]);
    expect([...bytes.slice(view.getUint32(10, true), view.getUint32(10, true) + 6)]).toEqual([0, 0, 255, 255, 255, 255]);
  } else if (format === "ico") {
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true), bytes[6], bytes[7]]).toEqual([0, 1, 1, 2, 1]);
    expect([...bytes.slice(62, 70)]).toEqual([0, 0, 255, 255, 255, 255, 255, 255]);
  } else {
    expect([...bytes.slice(0, 4)]).toEqual([73, 73, 42, 0]);
    const ifd = view.getUint32(4, true), entries = view.getUint16(ifd, true);
    const tags = new Map<number, number>();
    for (let index = 0; index < entries; index++) tags.set(view.getUint16(ifd + 2 + index * 12, true), view.getUint32(ifd + 10 + index * 12, true));
    expect([tags.get(256), tags.get(257), tags.get(259), tags.get(262)]).toEqual([2, 1, 1, 2]);
    expect([...bytes.slice(tags.get(273), tags.get(273)! + 6)]).toEqual([255, 0, 0, 255, 255, 255]);
  }
});
it.each([[257, 1], [1, 257]])("rejects ICO dimensions %sx%s using the native save failure without clamping", async (width, height) => {
  await expect(encodeGraphImage({ width, height, commands: [], raster: {
    width, height, rgba: new Uint8Array(width * height * 4)
  } }, "ico", context)).rejects.toThrow("Unknown failure while saving image");
});
it.each([[256, 1], [1, 256]])("encodes the ICO 256-axis sentinel for dimensions %sx%s", async (width, height) => {
  const bytes = await encodeGraphImage({ width, height, commands: [], raster: {
    width, height, rgba: new Uint8Array(width * height * 4)
  } }, "ico", context);
  expect([bytes[6], bytes[7]]).toEqual([width === 256 ? 0 : width, height === 256 ? 0 : height]);
});
it.each(["bmp", "ico", "tiff"])("admits %s output and raster work budgets before encoding", async format => {
  await expect(encodeGraphImage(surface, format, { ...context, limits: { ...context.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(encodeGraphImage(surface, format, { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("preserves vector geometry and text instead of encoding an empty surface", async () => {
  const scene: ImageSurface = { width: 71, height: 35, commands: [
    { kind: "rectangle", x: 3, y: 4, width: 20, height: 10, fill: "#ff0000" },
    { kind: "text", x: 6, y: 20, text: "A&B (test)", size: 10, font: "Helvetica", fill: "#000000" }
  ] };
  expect(new TextDecoder().decode(await encodeGraphImage(scene, "svg", context))).toContain('A&amp;B (test)');
  expect(new TextDecoder().decode(await encodeGraphImage(scene, "pdf", context))).toContain('3 4 20 10 re f');
  expect(new TextDecoder().decode(await encodeGraphImage(scene, "ps", context))).toContain('A&B \\(test\\)');
  await expect(encodeGraphImage(scene, "png", context)).rejects.toThrow("raster surface");
});
it("observes cancellation and rejects excessive raster memory before encoding", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(encodeGraphImage(surface, "png", { ...context, signal: controller.signal })).rejects.toThrow("cancelled");
  await expect(encodeGraphImage(surface, "png", { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it.each(["nul\u0000text", "control\u0001text", "surrogate\ud800text", "noncharacter\ufffetext"])("rejects text that cannot form valid SVG XML: %j", async text => {
  await expect(encodeGraphImage({ width: 10, height: 10, commands: [
    { kind: "text", x: 0, y: 5, text, size: 5, font: "Helvetica", fill: "#000000" }
  ] }, "svg", context)).rejects.toThrow("Unsupported image text encoding");
});
it("charges UTF-8 bytes before proceeding to the next SVG command", async () => {
  const commands: ImageSurface["commands"][number][] = [
    { kind: "text", x: 0, y: 5, text: "é".repeat(200), size: 5, font: "Helvetica", fill: "#000000" }
  ];
  Object.defineProperty(commands, 1, { get() { throw new Error("processed after exceeding byte budget"); } });
  await expect(encodeGraphImage({ width: 10, height: 10, commands }, "svg", {
    ...context, limits: { ...context.limits, outputBytes: 400 }
  })).rejects.toMatchObject({ code: "resource-limit" });
});
it("preserves valid supplementary Unicode and XML whitespace in SVG text", async () => {
  const text = "é🙂\t\n\r<&>\"";
  const bytes = await encodeGraphImage({ width: 10, height: 10, commands: [
    { kind: "text", x: 0, y: 5, text, size: 5, font: "Helvetica", fill: "#000000" }
  ] }, "svg", context);
  expect(new TextDecoder().decode(bytes)).toContain("é🙂\t\n\r&lt;&amp;&gt;&quot;");
});
it.each(["svg", "pdf", "ps", "eps"])("rejects unsupported runtime font metadata in %s rather than interpolating or substituting it", async format => {
  const malformed = {
    width: 10, height: 10,
    commands: [{ kind: "text", x: 0, y: 5, text: "safe", size: 5,
      font: 'Helvetica"/><script>unsafe</script><text font-family="Helvetica', fill: "#000000" }]
  } as unknown as ImageSurface;
  await expect(encodeGraphImage(malformed, format, context)).rejects.toThrow("Unsupported image font");
});
it.each(["pdf", "ps", "eps"])("admits %s text work before encoding long literals", async format => {
  await expect(encodeGraphImage({ width: 10, height: 10, commands: [
    { kind: "text", x: 0, y: 5, text: "a".repeat(1000), size: 5, font: "Helvetica", fill: "#000000" }
  ] }, format, { ...context, limits: { ...context.limits, workbookWork: 10 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it.each(["svg", "pdf", "ps", "eps"])("charges cumulative text work across %s scene commands", async format => {
  const command = { kind: "text" as const, x: 0, y: 5, text: "abcdef", size: 5, font: "Helvetica" as const, fill: "#000000" };
  await expect(encodeGraphImage({ width: 10, height: 10, commands: [command, command] }, format,
    { ...context, limits: { ...context.limits, workbookWork: 10 } })).rejects.toMatchObject({ code: "resource-limit" });
});
