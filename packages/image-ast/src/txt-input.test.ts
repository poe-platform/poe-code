import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readTxtFromSource } from "./codecs/txt.js";
const text = `# ImageMagick pixel enumeration: 1,1,0,255,srgba
0,0: (30,40,50,128) #1E283280 srgba(30,40,50,0.501961)
`;
const bytes = new TextEncoder().encode(text);
it.each(["rgb", "rgba", "srgb", "srgba"])("preserves %s TXT samples and their declared colorspace", async space => {
  const alpha = space.endsWith("a");
  const input = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,65535,${space}\n0,0: (4660,12345,65535${alpha ? ",32768" : ""})\n`);
  const metadata = { channels: alpha ? 4 : 3, hasAlpha: alpha, depth: "ushort" };
  const decoded = decodeImage(input);
  expect(decoded).toMatchObject({ ...metadata, data16: Uint16Array.of(4660,12345,65535,alpha ? 32768 : 65535) });
  const source = { size: input.length, async read(position: number, length: number) { return input.subarray(position, position + length); } };
  for (const result of [decoded, readImageMetadata(input), await readTxtFromSource(source, undefined, new AbortController().signal)]) {
    expect(result).toMatchObject(metadata);
    if (space.startsWith("rgb")) expect(result).toMatchObject({ magickColorspace: "RGB", gamma: 1 });
    else expect(result).not.toHaveProperty("magickColorspace");
  }
});
it("reports TXT metadata and selects pages with distinct dimensions", () => {
  const sequence = new TextEncoder().encode(text + `# ImageMagick pixel enumeration: 2,1,65535,gray
0,0: (4660) gray(7.1107%)
1,0: (4661) gray(7.11223%)
`);
  expect(readImageMetadata(sequence)).toMatchObject({ format: "txt", width: 1, height: 1, pages: 2, hasAlpha: true });
  expect(decodeImage(sequence, { page: 1 })).toMatchObject({ width: 2, height: 1, data16: Uint16Array.of(4660,4660,4660,65535,4661,4661,4661,65535) });
  expect(() => decodeImage(sequence, { page: 2 })).toThrow("page is out of range");
  expect(() => decodeImage(sequence, { limitInputPixels: 1 })).toThrow("pixel limit");
});
it.each([
  text.replace("1,1,0,255", "0,1,0,255"),
  text.replace("1,1,0,255", "1,1,0,0"),
  text.replace("30,40,50,128", "30,40,50,Infinity"),
  text.replace("30,40,50,128", "-1,40,50,128"),
  text.replace("0,0:", "1,0:"),
  text.replace("0,0:", "-1,0:"),
  text.replace("0,0:", "0,1:"),
  text.replace("0,0:", "0,-1:"),
  text.replace("0,0:", "0.5,0:"),
  text.replace("0,0:", "0,NaN:"),
  text.slice(0, text.indexOf("\n") + 1),
  text.replace("srgba\n", "unknown\n")
])("rejects malformed TXT input", text => {
  expect(() => decodeImage(new TextEncoder().encode(text))).toThrow();
});
it("clamps above-range TXT color and alpha channels", () => {
  const input = new TextEncoder().encode(text.replace("0,255,srgba", "0,256,srgba").replace("30,40,50,128", "256,40,50,256"));
  expect(decodeImage(input).data).toEqual(Uint8Array.of(255,40,50,255));
});
it("honors cancellation and rejects truncated source reads", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  await expect(readTxtFromSource(source, undefined, controller.signal)).rejects.toThrow("cancelled");
  await expect(readTxtFromSource({ ...source, async read() { return new Uint8Array(); } }, undefined, new AbortController().signal)).rejects.toThrow("Truncated TXT source");
});

it("retains native HSL samples and colorspace independently for each TXT page", async () => {
  // ImageMagick 7.1.2-35: magick xc:'#208040' -colorspace HSL -depth 16 txt:-
  const hsl = `# ImageMagick pixel enumeration: 1,1,0,65535,hsl
0,0: (25486,39321,20560)  #638E99995050  hsl(140,60%,31.3725%)
`;
  const sequence = new TextEncoder().encode(hsl + text);
  expect(decodeImage(sequence)).toMatchObject({
    magickColorspace: "HSL", depth: "ushort", hasAlpha: false, pages: 2,
    data16: Uint16Array.of(25486,39321,20560,65535)
  });
  const source = { size: sequence.length, async read(position: number, length: number) { return sequence.subarray(position, position + length); } };
  expect(await readTxtFromSource(source, undefined, new AbortController().signal)).toMatchObject({ magickColorspace: "HSL", pages: 2 });
  const second = decodeImage(sequence, { page: 1 });
  expect(second).not.toHaveProperty("magickColorspace");
  expect(second.data).toEqual(Uint8Array.of(30,40,50,128));
});
