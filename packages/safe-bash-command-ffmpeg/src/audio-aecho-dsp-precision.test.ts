import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete signed PCM32 reference output from FFmpeg 7.0.2, including the echo tail.
const echo = "aecho=0.625:0.75:0.125:0.5";
const echoed = [30750720, -36808704, -49035264, 718848, 154208256, 122953728, 583680, 251904, -172032];
const integerEcho = [30736384, -36765696, -49020928, 655360, 154206208, 122945536, 524288, 196608, -131072];
for (const [consumer, format, expected, integer, double] of [
  ["dcshift=shift=0", "s32p", echoed, integerEcho, echoed],
  ["deesser", "dblp", echoed, integerEcho, echoed],
  ["crystalizer", "fltp", [92252160, -171927552, -73488384, 100227072, 461187072, 60444672, -244156416, -411648, -1019904], [92209152, -171769856, -73531392, 100007936, 461307904, 60424192, -244318208, -458752, -786432]],
  ["speechnorm", "fltp", [61501440, -73617408, -98070528, 1437696, 308416512, 245907456, 1167360, 503808, -344064], [61472768, -73531392, -98041856, 1310720, 308412416, 245891072, 1048576, 393216, -262144]],
  ["dynaudnorm=f=10:g=3", "dblp", echoed, integerEcho, echoed],
  ["compand", "dblp", [29614664, -35452500, -47233424, 692506, 148571826, 118471404, 562461, 242772, -165813], [29600857, -35411077, -47219615, 631345, 148569854, 118463511, 505228, 189480, -126334]],
  ["afreqshift=shift=0", "fltp", [41448, -49613, -1876454, 2167976, 14955910, -14074540, -48953116, 18129832, 93622448], [41429, -49555, -1875590, 2165359, 14949534, -14054226, -48937776, 18076434, 93615096],
    [41448, -49613, -1876454, 2167976, 14955911, -14074542, -48953114, 18129832, 93622456]],
  ["atilt", "fltp", [30750720, -36808704, -49035268, 718852, 154208240, 122953736, 583664, 251916, -172041], [30736384, -36765696, -49020932, 655368, 154206208, 122945520, 524304, 196597, -131065], echoed]
] as const) {
  for (const [prefix, middle, expectedFormat, samples] of [
    ["", "", format, expected],
    [`aformat=sample_fmts=${format},`, "", format, expected],
    ["aformat=s16p,", "", "s16p", integer],
    ["", ",aformat=s16p", "s16p", integer],
    ["aformat=dblp,", "", "dblp", double ?? expected],
    ["", ",ashowinfo", format, expected]
  ] as const) {
    for (const graph of [false, true]) {
      for (const stereo of [false, true]) {
        const filter = `${prefix}${echo}${middle},${consumer}`;
        it(`negotiates ${filter} (${graph ? "complex" : "simple"}, ${stereo ? "stereo" : "mono"})`, async () => {
          const fs = Volume.fromJSON({});
          const input = Float64Array.from([1001, -1999, 3, 21, 5003, 0, 19, -7], sample => sample / 32768);
          fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
            channels: stereo ? [input, new Float64Array(input.length)] : [input] }));
          let stderr = "";
          const stdout: Buffer[] = [];
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-loglevel", middle === ",ashowinfo" ? "info" : "error", "-i", "/in.wav", ...(graph
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return fs.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
              async stat(path: string) { return fs.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          if (middle === ",ashowinfo") {
            const frames = stderr.split("\n").filter(line => line.includes("fmt:"));
            assert.equal(frames.length, 2, stderr);
            for (const frame of frames) {
              assert.ok(frame.includes(`fmt:${expectedFormat} `), frame);
              assert.ok(frame.includes(`channels:${stereo ? 2 : 1} `), frame);
              assert.ok(frame.includes(`chlayout:${stereo ? "stereo" : "mono"} `), frame);
            }
          } else assert.equal(stderr, "");
          const pcm = Buffer.concat(stdout);
          assert.deepEqual(Array.from({ length: pcm.length / 4 }, (_, index) => pcm.readInt32LE(index * 4)),
            stereo ? samples.flatMap(sample => [sample, 0]) : samples);
        });
      }
    }
  }
}
