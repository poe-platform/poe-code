import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Decoded PCM reference from native FFmpeg; WAV headers are deliberately excluded.
const native = {
  mono: [
    [1, 353, 353], [2, -442, -442], [3, -973, -973], [4, -1, -1],
    [5, -531, -531], [6, 441, 441], [7, -796, -796], [8, 706, 706],
    [9, 441, 441], [10, 1148, 1148], [11, -266, -266], [12, -1680, -1680],
    [13, -443, -443], [14, 176, 176], [15, 264, 264], [16, 352, 352],
    [17, -620, -620], [18, 794, 794], [19, 87, 87], [20, -89, -89],
    [21, -531, -531], [22, -619, -619], [23, -708, -708], [24, -443, -443],
    [25, 795, 795], [26, 883, 883], [27, -442, -442], [28, 264, 264],
    [29, 530, 530], [30, -531, -531], [31, -620, -620], [32, -178, -178]
  ],
  impulses: [
    [1, 0, 375], [2, -469, 0], [3, -1032, 0], [4, -563, 562],
    [5, -1125, 562], [6, 843, -375], [7, -188, -657], [8, 2062, -1313],
    [9, -938, 1406], [10, 656, 562], [11, -1688, 1406], [12, -469, -1313],
    [13, -563, 93], [14, 0, 187], [15, 2156, -1875], [16, 656, -282],
    [17, 375, -1032], [18, -282, 1125], [19, -2719, 2812], [20, -657, 562],
    [21, 93, -657], [22, -469, -188], [23, -282, -469], [24, -94, -375],
    [25, 281, 562], [26, 93, 843], [27, 0, -469], [28, 468, -188],
    [29, 281, 281], [30, -469, -94], [31, -1032, 375], [32, -563, 375],
    [2049, -250, 0], [2050, 0, 312], [2051, 0, 687], [2052, -375, 375],
    [2053, -375, 750], [2054, 250, -563], [2055, 437, 125], [2056, 875, -1375],
    [2057, -938, 625], [2058, -375, -438], [2059, -938, 1125], [2060, 875, 312],
    [2061, -63, 375], [2062, -125, 0], [2063, 1250, -1438], [2064, 187, -438],
    [2065, 687, -250], [2066, -750, 187], [2067, -1875, 1812], [2068, -375, 437],
    [2069, 437, -63], [2070, 125, 312], [2071, 312, 187], [2072, 250, 62],
    [2073, -375, -188], [2074, -563, -63], [2075, 312, 0], [2076, 125, -313],
    [2077, -188, -188], [2078, 62, 312], [2079, -250, 687], [2080, -250, 375]
  ],
  clipping: [
    [1, -1024, -1024], [2, 2303, 2303], [3, 2559, 2559], [4, -3073, -5120],
    [5, 1023, -1537], [6, -2305, -5889], [7, 2047, -3585], [8, 1023, -5120],
    [9, -6912, 255], [10, -4608, -1025], [11, -769, 1279], [12, 14847, 3071],
    [13, 4351, -13569], [14, -10496, -1793], [15, -3585, -2049], [16, -9728, -6144],
    [17, 15614, -257], [18, -4096, 1535], [19, -15104, 1279], [20, 6143, -10753],
    [21, -9217, 5119], [22, 28415, -17664], [23, 4351, -7425], [24, -32768, 25087],
    [25, 6399, -32768], [26, -2817, -8961], [27, 12287, 14335], [28, 12031, -27392],
    [29, -22784, 12542], [30, -5889, 4351], [31, 2559, -23552], [32, 20991, -5633],
    [33, -2561, 4607], [34, -15360, -7680], [35, 1535, -19969], [36, -15873, 12287],
    [37, 29183, -19968], [38, 7167, -17409], [39, -32768, 28671], [40, 9727, -32768],
    [41, -6145, -9729], [42, 11263, 16383], [43, 15359, -31744], [44, -23552, 6655],
    [45, -8193, 2047], [46, 2047, -24064], [47, 20991, -5633], [48, -2561, 4607],
    [49, -15360, -7680], [50, 1535, -19969], [51, -15873, 12287], [52, 29183, -19968],
    [53, 7167, -17409], [54, -32768, 28671], [55, 9727, -32768], [56, -6145, -9729],
    [57, 11263, 16383], [58, 15359, -31744], [59, -23552, 6655], [60, -8193, 2047],
    [61, 2047, -24064], [62, 20991, -5633], [63, -2561, 4607], [64, -15360, -7680],
    [65, 1535, -19969], [66, -15873, 12287], [67, 29183, -19968], [68, 7167, -17409],
    [69, -32768, 28671], [70, 9727, -32768], [71, -6145, -9729], [72, 11263, 16383],
    [73, 15359, -31744], [74, -23552, 6655], [75, -8193, 2047], [76, 2047, -24064],
    [77, 20991, -5633], [78, -2561, 4607], [79, -15360, -7680]
  ]
} as const;

for (const complex of [false, true]) {
  for (const name of ["impulses", "clipping", "mono", "mono explicit stereo", "48000 Hz"] as const) {
    it(`earwax ${complex ? "graph" : "simple"}: ${name}`, async () => {
      const mono = name.startsWith("mono");
      const length = name === "impulses" ? 8192 : mono ? 2059 : 80;
      const channels = [new Float64Array(length), new Float64Array(length)];
      for (let i = 0; i < length; i++) {
        channels[0]![i] = (name === "impulses" ? (i === 0 ? 12000 : 0) : (i % 3 ? 32767 : -32768)) / 32768;
        channels[1]![i] = (name === "impulses" ? (i === 2048 ? -8000 : 0) : (i % 5 ? 32767 : -32768)) / 32768;
      }
      if (mono) {
        channels.pop();
        channels[0]!.fill(0);
        channels[0]![0] = 16000 / 32768;
      }
      const filter = name === "mono explicit stereo" ? "aformat=channel_layouts=stereo,earwax" : "earwax";
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: name === "48000 Hz" ? 48000 : 44100, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (name === "48000 Hz") {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /earwax: 44100 Hz stereo input required/);
        assert.equal(volume.existsSync("/out.wav"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 44100);
      const expected = [new Array<number>(length).fill(0), new Array<number>(length).fill(0)];
      for (const [frame, left, right] of native[name === "mono explicit stereo" ? "mono" : name]) {
        expected[0]![frame!] = left!;
        expected[1]![frame!] = right!;
      }
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}
