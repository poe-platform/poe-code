import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { shiftAudioPhase } from "./audio-aphaseshift.js";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes: 32 stereo frames at 8 kHz, in 8-frame packets.
for (const [name, shift, staticHash, scheduledHash, sample] of [
  ["aphaseshift", "0.5", "77aedc2712a9781f6db3eed96c85e0ee9545e22bf935b242640d4544a1edcea1",
    "d66840ea08272783f956ca4fe9d1b830852d3a4d7d2cec3b30b13ada00a5e267", [-668, 545]],
  ["afreqshift", "400", "825972ffdce4ac66dae1a7cb316ed58fa29a4661ddc9261c64910c2acf7ef03c",
    "925aa16836323e17b3ad42218fa5d3428da1d80c2e183046e57459c08dbee297", [-3601, 3178]]
] as const) {
  for (const graph of [false, true]) {
    for (const [filter, hash, frameEight] of [
      [name, "2f34ada83260ab450ffd4e260a10937240ad2d729afab0f8ddeec3d3e9a296e3", [3966, -3532]],
      [`${name}=shift=${shift}`, staticHash, sample],
      ...[name, `${name}@edit`].map(target => [
        `asendcmd=c='0.001 ${target} shift ${shift}',${target}`, scheduledHash, sample
      ] as const)
    ] as const) {
      it(`${filter} matches native scheduled shift (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 32 }, (_, i) => (701 * i - 12400) / 32768),
          Float64Array.from({ length: 32 }, (_, i) => (11000 - 537 * i) / 32768)
        ] }));
        const chain = `asetnsamples=n=8:p=0,${filter}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 128);
        assert.deepEqual([output.readInt16LE(32), output.readInt16LE(34)], frameEight);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      });
    }
  }
}

for (const [name, shift, rejected] of [["aphaseshift", 0.5, "2"], ["afreqshift", 400, "2147483648"]] as const) {
  for (const format of ["fltp", "dblp"]) {
    it(`${name} retains stereo history through repeated and rejected shifts (${format})`, async () => {
      const channels = [
        Float64Array.from({ length: 32 }, (_, i) => (701 * i - 12400) / 32768),
        Float64Array.from({ length: 32 }, (_, i) => (11000 - 537 * i) / 32768)
      ];
      const frames = [{ start: 0, end: 32, pts: 0 }];
      const baseline = await Promise.all([0, shift, -shift].map(value =>
        shiftAudioPhase(channels, 8000, `${name}=shift=${value}`, format, frames, new MediaBudgetTracker())));
      const actual = await shiftAudioPhase(channels, 8000, name, format, frames, new MediaBudgetTracker(), undefined, [
        { sample: 8, action: "shift", expression: String(shift) },
        { sample: 12, action: "shift", expression: rejected },
        { sample: 14, action: "shift", expression: "invalid" },
        { sample: 16, action: "shift", expression: String(-shift) },
        { sample: 20, action: "shift", expression: "nan" },
        { sample: 22, action: "shift", expression: "inf" },
        { sample: 24, action: "level", expression: "0.5" },
        { sample: 28, action: "shift", expression: "0" }
      ]);
      actual.forEach((channel, c) => channel.forEach((sample, i) => {
        const reference = baseline[i < 8 || i >= 28 ? 0 : i < 16 ? 1 : 2]![c]![i]!;
        const expected = reference * (i < 24 ? 1 : 0.5);
        assert.equal(sample, format === "fltp" ? Math.fround(expected) : expected, `channel ${c}, sample ${i}`);
      }));
    });
  }
}
