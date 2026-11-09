import { expect, it } from "vitest";
import { parseY4m, serializeY4m } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe positions for these exact 4x2 YUV420 fixtures, including FRAME tags.
const header = Buffer.from("YUV4MPEG2 W4 H2 F25:1 Ip A1:1 C420jpeg\n");
const payloads = ["10171e252c333a41484f565d", "242b323940474e555c636a71", "383f464d545b626970777e85"]
  .map(hex => Buffer.from(hex, "hex"));
const fixtures = [
  { name: "plain", tags: ["FRAME\n", "FRAME\n", "FRAME\n"], positions: [45, 63, 81] },
  { name: "tags", tags: ["FRAME Xlong=hello\n", "FRAME\n", "FRAME Xt=12\n"], positions: [57, 75, 99] }
];

for (const { name, tags, positions } of fixtures) {
  const bytes = Buffer.concat([header, ...tags.flatMap((tag, index) => [Buffer.from(tag), payloads[index]!])]);
  const packets = positions.map((pos, pts) => ({ pts, pos: String(pos), size: "12" }));
  const frames = positions.map((pos, pts) => ({ pts, pkt_pos: String(pos), pkt_size: "12" }));

  it(`retains file-relative ${name} Y4M sample offsets with a sliced input buffer`, () => {
    const sliced = Buffer.concat([Buffer.alloc(17), bytes]).subarray(17);
    const doc = parseY4m(sliced);
    expect(doc.tracks[0]!.samples.map(({ offset, size, pts }) => ({ offset, size, pts })))
      .toEqual(positions.map((offset, pts) => ({ offset, size: 12, pts })));
    expect(doc.tracks[0]!.decodedVideoFrames!.map(frame => Buffer.from(frame.native!.pixels))).toEqual(payloads);
    expect(Buffer.from(serializeY4m(doc))).toEqual(Buffer.concat([
      header, ...payloads.flatMap(payload => [Buffer.from("FRAME\n"), payload])
    ]));
  });

  for (const route of ["file", "stdin", "sync"]) {
    for (const section of ["packets", "frames", "both"]) {
      it(`reports physical ${name} Y4M ${section} positions via ${route}`, async () => {
        const args = ["-v", "error", ...(section !== "frames" ? ["-show_packets"] : []),
          ...(section !== "packets" ? ["-show_frames"] : []), "-of", "json",
          route === "stdin" ? "pipe:0" : "/clip.y4m"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/clip.y4m", bytes);
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
          expect(diagnostic).toBe("");
        }
        const expected = section === "both" ? packets.flatMap((packet, index) => [
          { type: "packet", ...packet }, { type: "frame", ...frames[index] }
        ]) : section === "packets" ? packets : frames;
        expect(JSON.parse(output)[section === "both" ? "packets_and_frames" : section]).toMatchObject(expected);
      });
    }
  }
}
