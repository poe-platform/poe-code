import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: scale the offset packet PTS, keeping PCM and packet durations intact.
const pcm = Buffer.alloc(48 * 4);
for (let i = 0; i < 48; i++) {
  pcm.writeInt16LE(i >= 8 && i < 16 || i >= 34 ? 5000 : 0, i * 4);
  pcm.writeInt16LE(i >= 11 && i < 19 || i >= 32 && i < 38 ? -8000 : 0, i * 4 + 2);
}
const wav = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from({ length: 48 }, (_, i) => pcm.readInt16LE(i * 4 + channel * 2) / 32768)) });
const cases = [
  { flags: ["-itsoffset", "0.01"], start: 0.01 },
  { flags: ["-itsoffset", "0.01", "-itsscale", "2"], start: 0.02 },
  { flags: ["-itsscale", "2", "-itsoffset", "0.01"], start: 0.02 },
  { flags: ["-itsoffset", "0.01", "-itsscale", "0.5"], start: 0.005 },
  { flags: ["-itsoffset", "0.01", "-itsscale:a:0", "2"], start: 0.02 },
  { flags: ["-itsoffset", "0.01", "-itsscale:v", "2"], start: 0.01 },
  { flags: ["-itsoffset", "0.01", "-itsscale", "3", "-itsscale:a", "2"], start: 0.02 },
  { flags: ["-itsscale", "2"], start: 0 }
];

for (const graph of [false, true]) {
  for (const trim of [false, true]) {
    for (const { flags, start } of cases) {
      it(`scales PCM input timestamps before ${trim ? "atrim" : "silencedetect"} (graph=${graph}): ${flags.join(" ")}`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(wav) });
        const filter = trim ? "atrim=start_pts=160:end_pts=184"
          : "asetnsamples=n=7:p=0,silencedetect=n=0.01:d=0.0005:m=1";
        const args = ["-hide_banner", "-nostats", "-loglevel", "info", ...flags, "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"];
        // These filters must decline the synchronous optimization without writing output.
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          () => { assert.fail("sync fallback wrote output"); }), undefined);
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(stdout);
        const expected = trim ? pcm.subarray(0, start === 0.02 ? 24 * 4 : 0) : pcm;
        assert.deepEqual(output, expected);
        assert.equal(createHash("sha256").update(output).digest("hex"), !trim
          ? "d78d19f717c9404f29c3efaebdb58bddfbbc8ccf602f5c732811b4ee68c71a2c"
          : start === 0.02 ? "678bcb7f500805cd513b1a79e73bc5abf094c653d71b653bf558d7399c2f3491"
            : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(wav));
        const events = stderr.split("\n").filter(line => line.includes("channel:")).map(line => line.slice(line.indexOf("channel:")));
        assert.deepEqual(events.slice(0, 4), trim ? [] : [
          `channel: 0 | silence_start: ${start}`,
          `channel: 1 | silence_start: ${start}`,
          `channel: 0 | silence_end: ${(start * 8000 + 8) / 8000} | silence_duration: 0.001`,
          `channel: 1 | silence_end: ${(start * 8000 + 11) / 8000} | silence_duration: 0.001375`
        ]);
      });
    }
  }
}
