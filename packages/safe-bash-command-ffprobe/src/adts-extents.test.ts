import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeId3 } from "@poe-code/audio-ast";
import { parseAacAdts, serializeAacAdts } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe packet/frame extents for these synthetic mono AAC tones.
const fixtures = [
  { name: "44100.aac", sizes: [287, 293, 200, 185, 186, 179, 221, 218, 216, 227, 184] },
  { name: "48000.aac", sizes: [216, 262, 165, 214, 201, 196, 197, 205, 196, 172, 229, 12] }
];
for (const { name, sizes } of fixtures) {
  const plain = readFileSync(new URL(`./fixtures/adts-extents-${name}`, import.meta.url));
  for (const variant of ["plain", "CRC", "ID3"] as const) {
    const prefix = variant === "ID3" ? encodeId3({ title: "Tone" }) : new Uint8Array();
    let cursor = 0;
    const chunks = sizes.map(size => {
      const original = plain.subarray(cursor, cursor += size);
      if (variant !== "CRC") return original;
      const frame = new Uint8Array(size + 2);
      frame.set(original.subarray(0, 7));
      frame[1]! &= ~1;
      frame[3] = (frame[3]! & 0xfc) | (frame.length >>> 11);
      frame[4] = (frame.length >>> 3) & 0xff;
      frame[5] = (frame[5]! & 0x1f) | ((frame.length & 7) << 5);
      frame.set(original.subarray(7), 9);
      return frame;
    });
    const bytes = Buffer.concat([prefix, ...chunks]);
    let position = prefix.length;
    const expected = chunks.map(chunk => {
      const extent = { pos: String(position), size: String(chunk.length) };
      position += chunk.length;
      return extent;
    });
    for (const route of ["file", "stdin", "sync"] as const) {
      for (const section of ["packet", "frame"] as const) {
        it(`reports physical ${name} ${variant} ${section} extents via ${route}`, async () => {
          const args = ["-v", "error", "-show_entries", section === "packet" ? "packet=pos,size" : "frame=pkt_pos,pkt_size", "-of", "json", route === "stdin" ? "-" : "/tone.aac"];
          let output = "", diagnostic = "";
          if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
          else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/tone.aac", bytes);
            const result = await createFfprobeCommand().execute({
              command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
              signal: new AbortController().signal,
              stdin: { async *[Symbol.asyncIterator]() {
                for (let at = 0; at < bytes.length; at += 7) yield bytes.subarray(at, at + 7);
              } },
              stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
              stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
            });
            expect(result.exitCode, diagnostic).toBe(0);
          }
          expect(JSON.parse(output)[`${section}s`]).toEqual(section === "packet" ? expected
            : expected.map(({ pos, size }) => ({ pkt_pos: pos, pkt_size: size })));
        });
      }
    }
    it(`keeps raw ${name} ${variant} AAC payloads for decoding and remuxing`, () => {
      const doc = parseAacAdts(bytes);
      expect(doc.tracks[0]!.samples.map(sample => sample.size)).toEqual(sizes.map(size => size - 7));
      expect(Buffer.from(serializeAacAdts(doc))).toEqual(plain);
    });
  }
}

it("keeps MP4 AAC packet extents unchanged", () => {
  const bytes = readFileSync(new URL("./fixtures/adts-extents-control.m4a", import.meta.url));
  const output = evalSyncFfprobe(undefined, ["-v", "error", "-show_entries", "packet=pos,size", "-of", "json", "/control.m4a"], () => bytes)!;
  let position = 44;
  expect(JSON.parse(output).packets).toEqual([209, 255, 158, 207, 194, 189, 190, 198, 189, 165, 222, 5].map(size => {
    const extent = { pos: String(position), size: String(size) };
    position += size;
    return extent;
  }));
});
