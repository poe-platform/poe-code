import { expect, it } from "vitest";
import { cafAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Independent four-frame stereo PCM16 CAFs; native FFmpeg 7.0.2/ffprobe
// exposes duration on stdin only when pakt precedes data, and never exposes size.
const fixtures = [
  { name: "lr", earlyTable: false, base64: "Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGxwY20AAAAAAAAABAAAAAEAAAACAAAAEGNoYW4AAAAAAAAADAABAAAAAAADAAAAAGRhdGEAAAAAAAAAFAAAAAAD6CMoB9AfQAu4G1gPoBdw" },
  { name: "primed", earlyTable: true, base64: "Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGxwY20AAAAAAAAABAAAAAEAAAACAAAAEHBha3QAAAAAAAAAGAAAAAAAAAAEAAAAAAAAAAIAAAABAAAAAWRhdGEAAAAAAAAAFAAAAAAD6CMoB9AfQAu4G1gPoBdw" },
  { name: "paktlate", earlyTable: false, base64: "Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGxwY20AAAAAAAAABAAAAAEAAAACAAAAEGRhdGEAAAAAAAAAFAAAAAAD6CMoB9AfQAu4G1gPoBdwcGFrdAAAAAAAAAAYAAAAAAAAAAQAAAAAAAAAAgAAAAEAAAAB" }
];

for (const { name, earlyTable, base64 } of fixtures) {
  const bytes = Buffer.from(base64, "base64");
  for (const target of ["pipe:0", "pipe:", "-", "/dev/stdin", "/dev/fd/0", "/input.caf"]) {
    const seekable = target === "/input.caf";
    for (const records of [[], ["-show_packets"], ["-show_frames"]]) {
      it(`reports available CAF duration and size for ${name} via ${target} ${records.join(" ")}`, async () => {
        const args = ["-v", "error", "-show_streams", "-show_format", ...records, "-of", "json", target];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.caf", bytes);
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {
            for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
          } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        for (const probe of [
          JSON.parse(output),
          JSON.parse(evalSyncFfprobe(seekable ? undefined : bytes, args, () => bytes)!),
          cafAst().probe(bytes, { seekable, showPackets: true, showFrames: true })
        ]) {
          const durationKnown = seekable || earlyTable;
          expect(probe.streams[0].duration_ts).toBe(durationKnown ? 4 : undefined);
          expect(probe.streams[0].duration).toBe(durationKnown ? "0.000500" : undefined);
          expect(probe.format.duration).toBe(durationKnown ? "0.000500" : undefined);
          expect(probe.format.size).toBe(seekable ? String(bytes.length) : undefined);
          expect(probe.format.bit_rate).toBe(seekable ? String(bytes.length * 16000) : earlyTable ? undefined : "256000");
          if (probe.packets) expect(probe.packets).toMatchObject([{ duration: 4, size: "16" }]);
          if (probe.frames) expect(probe.frames).toMatchObject([{ nb_samples: 4 }]);
        }
      });
    }
  }
  for (const target of ["pipe:0", "/input.caf"]) {
    it(`decodes all four CAF frames from ${name} via ${target}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.caf", bytes);
      const output: Uint8Array[] = [];
      let diagnostic = "";
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", ...createCommandArguments(["-v", "error", "-i", target, "-f", "s16be", "pipe:1"]),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output.push(chunk.slice()); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(Buffer.concat(output).toString("hex")).toBe("03e8232807d01f400bb81b580fa01770");
    });
  }
}
