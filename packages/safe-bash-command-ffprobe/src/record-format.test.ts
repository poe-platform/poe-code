import { expect, it } from "vitest";
import { wavAst } from "@poe-code/mp4-ast";
import { encodeWav } from "@poe-code/audio-ast";
import { formatFfprobeResult, formatFfprobeResultChunks } from "./media.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(2500)] });
const probe = wavAst().probe(bytes, { showPackets: true, showFrames: true });
for (const printFormat of ["json", "json=c=1", "json:compact=1", "csv", "compact", "flat", "default"]) {
  it(`preserves ${printFormat} output with one-shot packet/frame iterators`, () => {
    const opts = { printFormat, showFormat: true, showStreams: true, showPackets: true, showFrames: true, showChapters: true, showPrograms: true };
    const expected = printFormat.startsWith("json")
      ? JSON.stringify({ programs: [], packets: probe.packets, frames: probe.frames, streams: probe.streams, chapters: probe.chapters, format: probe.format }, null, printFormat === "json" ? 2 : undefined) + "\n"
      : formatFfprobeResult(probe, opts);
    const records = { ...probe, packets: (function* () { yield* probe.packets!; })(), frames: (function* () { yield* probe.frames!; })() };
    const parts = [...formatFfprobeResultChunks(records, opts)];
    expect(parts.join("")).toBe(expected);
    if (printFormat.startsWith("json")) expect(parts.length).toBeGreaterThan(10);
  });
}

it("does not enumerate records before the JSON header is consumed", () => {
  let read = 0;
  const packets = { *[Symbol.iterator]() { for (let i = 0; i < 10000; i++) { read++; yield probe.packets![0]!; } } };
  const parts = formatFfprobeResultChunks({ ...probe, packets }, {
    printFormat: "json", showFormat: false, showStreams: false, showPackets: true, showFrames: false, showChapters: false, showPrograms: false
  });
  expect(parts.next().value).toBe("{"); expect(read).toBe(0); parts.return(undefined);
});

it("does not swallow consumer errors while yielding the qualified audio schema", () => {
  const parts = formatFfprobeResultChunks(probe, {
    printFormat: "json", showFormat: false, showStreams: true, showPackets: false, showFrames: false, showChapters: false, showPrograms: false
  }, { bytes, args: ["-of", "json", "-show_streams", "input.wav"] });
  parts.next();
  const reason = new Error("consumer failed");
  expect(() => parts.throw(reason)).toThrow(reason);
});
