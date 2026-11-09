import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { wavAst, aiffAst, auAst, cafAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const sampleRate of [8000, 44100]) for (const format of ["wav", "aiff", "au", "caf"]) {
  for (const limit of [0, 1, 2, 3, undefined]) for (const resample of [false, true]) for (const grouped of resample ? [false, true] : [false]) {
    it(`${sampleRate} Hz ${format} frames=${limit ?? "all"} resample=${resample} grouped=${grouped}`, async () => {
      const length = resample ? 1024 : 6000;
      const samples = Float64Array.from({ length }, (_, i) => resample ? 12000 / 32768 : i / 32768);
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate, channels: [samples] })) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.wav", ...(resample ? ["-ar", String(sampleRate * 2)] : []),
          ...(grouped ? ["-af", "asetnsamples=n=8:p=0"] : []),
          ...(limit === undefined ? [] : ["-frames:a", String(limit)]),
          "-c:a", format === "aiff" || format === "au" ? "pcm_s16be" : "pcm_s16le", `/out.${format}`],
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
      const ast = { wav: wavAst, aiff: aiffAst, au: auAst, caf: cafAst }[format]!();
      const audio = ast.parse(volume.readFileSync(`/out.${format}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      const packet = sampleRate === 8000 ? 512 : 4096;
      const count = limit === 0 ? 0 : limit === undefined ? length * (resample ? 2 : 1)
        : grouped ? 32 + limit * 16
        : resample ? limit > Math.ceil(length / packet) ? length * 2 : Math.min(length, limit * packet) * 2 - 32
        : Math.min(length, limit * packet);
      assert.equal(audio.length, count);
      assert.deepEqual(Array.from(audio), resample ? Array<number>(count).fill(12000 / 32768) : Array.from(samples.slice(0, count)));
    });
  }
}

for (const codec of ["copy", "pcm_s16le"]) for (const limit of [2, undefined]) {
  it(`segments ${codec} PCM with frames=${limit ?? "all"}`, async () => {
    const samples = Float64Array.from({ length: 24000 }, (_, i) => i / 32768);
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [samples] })) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", "-c:a", codec, ...(limit === undefined ? [] : ["-frames:a", String(limit)]),
        "-f", "segment", "-segment_time", "1", "-segment_list", "/list.csv", "/part%02d.wav"],
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
    const parts = volume.readdirSync("/").filter(name => String(name).startsWith("part")).sort();
    const pcm = parts.map(name => wavAst().parse(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), limit === undefined ? [8192, 8192, 7616] : [1024]);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)), Array.from(samples.slice(0, limit === undefined ? 24000 : 1024)));
    assert.equal(volume.readFileSync("/list.csv", "utf8"), limit === undefined
      ? "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"
      : "part00.wav,0.000000,0.128000\n");
  });
}
