import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { shiftAudioPhase } from "./audio-aphaseshift.js";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference hashes for 8192 mono PCM16 samples at 8 kHz.
for (const [filter, hash] of [
  ["asendcmd=c=0.0 afreqshift level 0,afreqshift=250", "4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe"],
  ["asendcmd=c=0.0 aphaseshift level 0,aphaseshift=0.5", "4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe"],
  ["asendcmd=c=0.5 afreqshift level 0,afreqshift=250", "ca69c94380eb60b03a75995adb1d6f3ed0db60906e743c58e4af4f23d42ecd54"],
  ["asendcmd=c=0.5 aphaseshift level 0,aphaseshift=0.5", "e3c42f12d54cddfbcc504182409abbead3b8e468035ca2ebe27f2b61c2ae6568"],
  ["asendcmd=c=0.5 afreqshift@shift level 0,afreqshift@shift=250", "ca69c94380eb60b03a75995adb1d6f3ed0db60906e743c58e4af4f23d42ecd54"],
  ["asendcmd=c=0.5 aphaseshift@shift level 0,aphaseshift@shift=0.5", "e3c42f12d54cddfbcc504182409abbead3b8e468035ca2ebe27f2b61c2ae6568"],
  ["afreqshift=level=0", "4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe"],
  ["aphaseshift=level=0", "4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe"],
  ["afreqshift=250", "dec5b7b9b1c423ef5c61c1ccef4f2b3083904a9335e43a98b3d08590bf8deacf"],
  ["aphaseshift=0.5", "2bbe04db8657672587c0b8ed75d524cb3085aa73eead6f0b70d1e156a2e9e681"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native output (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 8192 }, (_, i) =>
          [0, 4592, 8485, 11087, 12000, 11087, 8485, 4592, 0, -4592, -8485, -11087, -12000, -11087, -8485, -4592][i % 16]! / 32768)
      ] }));
      const chain = filter;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "/out.raw"],
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
      assert.equal(output.length, 16384);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

for (const filter of ["afreqshift=250", "aphaseshift=0.5"]) {
  it(`${filter} retains DSP state and independent channel levels across runtime commands`, async () => {
    const channels = [Float32Array.from({ length: 128 }, (_, i) => Math.sin(i)),
      Float32Array.from({ length: 128 }, (_, i) => Math.cos(i))];
    const baseline = await shiftAudioPhase(channels, 8000, filter, "fltp", new MediaBudgetTracker());
    const actual = await shiftAudioPhase(channels, 8000, filter, "fltp", new MediaBudgetTracker(), undefined, [
      { sample: 16, expression: "0" }, { sample: 32, expression: "0.5" },
      { sample: 48, expression: "2" }, { sample: 56, expression: "invalid" },
      { sample: 64, expression: "1" }
    ]);
    actual.forEach((channel, c) => channel.forEach((sample, i) => {
      const level = i < 16 || i >= 64 ? 1 : i < 32 ? 0 : 0.5;
      assert.equal(sample, Math.fround(baseline[c]![i]! * level));
    }));
  });
}
