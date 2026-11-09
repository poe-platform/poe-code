import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Headers and payloads reproduce native ffprobe stream-only comparisons.
for (const [name, header, aspect, display, chroma, field, range] of [
  ["plain", "F25:1 Ip A1:1 C420jpeg", "1:1", "2:1", "center", "progressive"],
  ["rate", "F30000:1001 Ip A2:1 C420mpeg2", "2:1", "4:1", "left", "progressive"],
  ["top", "F25:1 It A1:1 C420jpeg", "1:1", "2:1", "center", "tt"],
  ["bottom", "F25:1 Ib A1:1 C420jpeg", "1:1", "2:1", "center", "bb"],
  ["full", "F25:1 Ip A1:1 C420jpeg XCOLORRANGE=FULL", "1:1", "2:1", "center", "progressive", "pc"],
  ["limited", "F25:1 Ip A1:1 C420jpeg XCOLORRANGE=LIMITED", "1:1", "2:1", "center", "progressive", "tv"]
] as const) {
  const bytes = Buffer.concat([
    Buffer.from(`YUV4MPEG2 W4 H2 ${header}\n`),
    ...[0, 1, 2].flatMap(frame => [Buffer.from("FRAME\n"),
      Buffer.from(Array.from({ length: 12 }, (_, pixel) => 16 + frame * 20 + pixel * 7))])
  ]);
  const expected = {
    codec_name: "rawvideo", codec_tag_string: "I420", codec_tag: "0x30323449",
    width: 4, height: 2, pix_fmt: "yuv420p", sample_aspect_ratio: aspect,
    display_aspect_ratio: display, chroma_location: chroma, field_order: field,
    ...(range ? { color_range: range } : {})
  };
  for (const mode of ["file", "stdin", "sync"]) {
    for (const selected of [false, true]) {
      it(`reports ${name} Y4M stream descriptors via ${mode}, selected=${selected}`, async () => {
        const args = ["-v", "error", ...(selected
          ? ["-show_entries", `stream=${[...Object.keys(expected), "color_range"].join(",")}`]
          : ["-show_streams"]), "-of", "json", mode === "file" ? "/clip.y4m" : "-"];
        let output = "", diagnostic = "";
        if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/clip.y4m", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
        }
        const probe = JSON.parse(output);
        expect(probe.streams).toHaveLength(1);
        if (selected) expect(probe.streams).toEqual([expected]);
        else expect(probe.streams[0]).toMatchObject(expected);
        expect(probe.streams[0].color_range).toBe(range);
        expect(probe).not.toHaveProperty("packets");
        expect(probe).not.toHaveProperty("frames");
      });
    }
  }
}
