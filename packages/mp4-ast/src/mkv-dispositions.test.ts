import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, probeMkv, serializeMkv } from "./containers/mkv.js";
import { writeVintSize } from "./containers/ebml.js";

it("reports native FFmpeg track dispositions and preserves them when remuxing", () => {
  const bytes = readFileSync(new URL("./fixtures/track-dispositions.mkv", import.meta.url));
  for (const input of [bytes, serializeMkv(parseMkv(bytes))]) {
    assert.deepEqual(probeMkv(input).streams.map(({ disposition: d }) =>
      [d.default, d.hearing_impaired, d.forced]), [[0, 0, 0], [1, 1, 0], [0, 0, 1]]);
  }
});

it("applies Matroska defaults and reads every supported track flag independently", () => {
  const element = (id: number[], ...parts: Uint8Array[]) => {
    const payload = Buffer.concat(parts);
    return Buffer.concat([Uint8Array.from(id), writeVintSize(payload.length), payload]);
  };
  const flags = [
    [[0x88], "default"], [[0x55, 0xaa], "forced"],
    [[0x55, 0xab], "hearing_impaired"], [[0x55, 0xac], "visual_impaired"],
    [[0x55, 0xad], "descriptions"], [[0x55, 0xae], "original"],
    [[0x55, 0xaf], "comment"]
  ] as const;
  const track = (id: number, values: Uint8Array[]) => element([0xae],
    element([0xd7], Uint8Array.of(id)), element([0x83], Uint8Array.of(17)),
    element([0x86], new TextEncoder().encode("S_TEXT/UTF8")), ...values);
  const bytes = Buffer.concat([element([0x1a, 0x45, 0xdf, 0xa3]),
    element([0x18, 0x53, 0x80, 0x67], element([0x16, 0x54, 0xae, 0x6b],
      track(1, []), track(2, flags.map(([id]) => element([...id], Uint8Array.of(0)))),
      ...flags.map(([id], i) => track(i + 3, [element([...id], Uint8Array.of(1))]))))]);
  const streams = probeMkv(bytes).streams;
  for (const [index, stream] of streams.entries()) {
    for (const [flagIndex, [, name]] of flags.entries()) {
      assert.equal(stream.disposition[name] ?? 0,
        index === 1 ? 0 : name === "default" || index === flagIndex + 2 ? 1 : 0, `${index}: ${name}`);
    }
  }
});
