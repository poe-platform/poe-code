import { expect, it } from "vitest";
import { encodeOgg } from "../packages/audio-ast/src/ogg.js";
import { oggAst } from "@poe-code/mp4-ast";
import { evalSyncFfprobe } from "../packages/safe-bash-command-ffprobe/src/media.js";

for (const explicit of [false, true]) it(`rejects an impossible Opus final granule (${explicit ? "explicit" : "automatic"}) in the synchronous command`, () => {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = 2;
  new DataView(head.buffer).setUint16(10, 312, true);
  const tags = new Uint8Array(16);
  tags.set(new TextEncoder().encode("OpusTags"));
  const bytes = encodeOgg([
    { data: head, serial: 1, granule: 0n, bos: true, eos: false },
    { data: tags, serial: 1, granule: 0n, bos: false, eos: false },
    // TOC 1 contains two 480-sample frames, not 48000 samples.
    { data: Uint8Array.of(1), serial: 1, granule: 48000n, bos: false, eos: true }
  ]);
  expect(() => oggAst().probe(bytes, { showPackets: true })).toThrow("Invalid Opus final granule");
  expect(evalSyncFfprobe(undefined,
    [...(explicit ? ["-f", "ogg"] : []), "-show_packets", "-of", "json", "/input.ogg"],
    () => bytes)).toBeUndefined();
});
