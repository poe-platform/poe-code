import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 2300, 6400, 0, 0, 0, -4200, 5100, 0, 0, 0, 8200, 0, 0, 0];

// Native FFmpeg 7.0.2: only frames forwarded after start removal retain pos.
for (const [filter, expected] of [
  ["silenceremove=start_periods=1:window=0,aselect='gt(pos,0)'", "00000000000098efec130000000000000820000000000000"],
  ["silenceremove=start_periods=1:window=0,aselect='isnan(pos)'", "fc080019"],
  ["silenceremove=start_periods=1:window=0", "fc08001900000000000098efec130000000000000820000000000000"],
  ["silenceremove,aselect='gt(pos,0)'", "00000000fc08001900000000000098efec130000000000000820000000000000"],
  ["aselect='gt(pos,0)'", "00000000fc08001900000000000098efec130000000000000820000000000000"],
  ["silenceremove=start_periods=1:window=0:timestamp=copy,aselect='gt(pos,0)'", "00000000000098efec130000000000000820000000000000"],
  ["silenceremove=start_periods=1:window=0:start_silence=0.002,aselect='gt(pos,0)'", "00000000000098efec130000000000000820000000000000"],
  ["silenceremove=start_periods=1:window=0:enable=0,aselect='gt(pos,0)'", "00000000000098efec130000000000000820000000000000"],
  ["silenceremove=start_periods=1:window=0:enable=0,aselect='isnan(pos)'", "00000000fc080019"],
  ["silenceremove=start_periods=2:window=0,aselect='gt(pos,0)'", ""],
  ["silenceremove=stop_periods=1:stop_threshold=1:window=0,aselect='gt(pos,0)'", ""],
  ["silenceremove=start_periods=1:stop_periods=1:window=0,aselect='gt(pos,0)'", ""]
] as const) for (const graph of [false, true]) {
  it(`preserves native source positions for ${filter} (graph=${graph})`, async () => {
    const volume = Volume.fromJSON({
      "/in.wav": Buffer.from(encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from(samples, value => value / 32768)] }))
    });
    const chain = `asetnsamples=n=4:p=0,${filter}`;
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
      "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
