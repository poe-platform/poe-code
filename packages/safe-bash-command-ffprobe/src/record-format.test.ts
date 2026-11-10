import { expect, it } from "vitest";
import { wavAst } from "@poe-code/mp4-ast";
import { encodeWav } from "@poe-code/audio-ast";
import { formatFfprobeResult, formatFfprobeResultChunks } from "./media.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(2500)] });
const probe = wavAst().probe(bytes, { showPackets: true, showFrames: true });
for (const printFormat of ["xml", "ini", "json", "json=c=1", "json:compact=1", "csv", "compact", "flat", "default"]) {
  it(`preserves ${printFormat} output with one-shot packet/frame iterators`, () => {
    const opts = { printFormat, showFormat: true, showStreams: true, showPackets: true, showFrames: true, showChapters: true, showPrograms: true };
    const expected = formatFfprobeResult(probe, opts);
    const records = { ...probe, packets: (function* () { yield* probe.packets!; })(), frames: (function* () { yield* probe.frames!; })() };
    const parts = [...formatFfprobeResultChunks(records, opts)];
    expect(parts.join("")).toBe(expected);
    if (printFormat === "ini") {
      expect(expected).toContain("[packets_and_frames.packet.0]\n");
      expect(expected).toContain("[packets_and_frames.frame.0]\n");
    }
    if (printFormat.startsWith("json")) {
      expect(parts.length).toBeGreaterThan(10);
      expect(JSON.parse(parts.join(""))).toEqual({
        programs: [],
        packets_and_frames: probe.packets!.flatMap((packet, index) => [{ type: "packet", ...packet }, { type: "frame", ...probe.frames![index] }]),
        streams: probe.streams.map(stream => ({ ...stream, nb_read_frames: "5", nb_read_packets: "5" })),
        chapters: probe.chapters,
        format: probe.format
      });
    }
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

it("closes both combined record sources when the consumer stops", async () => {
  const { formatFfprobeSourceChunks } = await import("./media.js");
  for (const asynchronous of [false, true]) {
    let packetsClosed = 0, framesClosed = 0, packetsRead = 0, framesRead = 0;
    function* packets() {
      try { for (const packet of probe.packets!) { packetsRead++; yield packet; } }
      finally { packetsClosed++; }
    }
    function* frames() {
      try { for (const frame of probe.frames!) { framesRead++; yield frame; } }
      finally { framesClosed++; }
    }
    const records = { ...probe, packets: packets(), frames: frames() };
    const opts = { printFormat: "json", showFormat: false, showStreams: false, showPackets: true, showFrames: true, showChapters: false, showPrograms: false };
    const chunks = asynchronous ? formatFfprobeSourceChunks(records, opts) : formatFfprobeResultChunks(records, opts);
    for await (const chunk of chunks) if (chunk.includes('"frame"')) break;
    expect(packetsRead).toBe(1); expect(framesRead).toBe(1);
    expect(packetsClosed).toBe(1); expect(framesClosed).toBe(1);
  }
});
