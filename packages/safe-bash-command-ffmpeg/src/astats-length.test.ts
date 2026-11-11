import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [
  Float64Array.from({ length: 2048 }, (_, i) => (i < 1536 ? [8192, -4096, 0, 4096][i % 4]! : 1024) / 32768),
  Float64Array.from({ length: 2048 }, (_, i) => (i < 1536 ? -16384 : 512) / 32768)
];

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/out.wav": "keep existing output" });
  volume.writeFileSync("/stereo.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/stereo.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.wav") as Buffer };
}

// Native FFmpeg 7.0.2, using the same 8 kHz stereo PCM and command arguments.
for (const [filter, peaks, troughs] of [
  ["astats", [-16.386257, -6.114698, -6.114698], [-21.506642, -11.662427, -21.506642]],
  ["astats=length=0.05", [-16.386257, -6.114698, -6.114698], [-21.506642, -11.662427, -21.506642]],
  ["astats=length=0.02", [-16.278302, -6.020629, -6.020629], [-27.241804, -19.819370, -27.241804]],
  ["astats=0.02", [-16.278302, -6.020629, -6.020629], [-27.241804, -19.819370, -27.241804]],
  ["astats=metadata=0:length=0.01+0.01:reset=0", [-16.278302, -6.020629, -6.020629], [-27.241804, -19.819370, -27.241804]],
  ["astats=length=0", [-12.040935, -6.020335, -6.020335], [-Infinity, -36.123334, -Infinity]],
  ["astats=length=10", [-17.490106, -7.268309, -7.268309], [-17.490106, -7.268309, -17.490106]]
] as const) {
  it(`${filter} matches native windowed RMS and preserves every PCM sample`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    for (const [i, name] of ["Channel: 1", "Channel: 2", "Overall"].entries()) {
      const section = result.stderr.split(`${name}\n`)[1]!;
      assert.ok(section, result.stderr);
      for (const [label, value] of [
        ["RMS level dB", [-17.490106, -7.268309, -9.884384][i]!],
        ["RMS peak dB", peaks[i]!], ["RMS trough dB", troughs[i]!]
      ] as const) {
        assert.equal(section.split(`${label}: `)[1]?.split("\n")[0], value === -Infinity ? "-inf" : value.toFixed(6), `${name} ${label}`);
      }
    }
    const audio = parseWav(result.output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
  });
}

for (const [length, status] of [
  ["-0.01", 222], ["10.01", 222], ["NaN", 234], ["Infinity", 222],
  ["nope", 234], ["", 234], ["0.02=extra", 234]
] as const) {
  it(`rejects invalid astats length ${JSON.stringify(length)} without replacing output`, async () => {
    const result = await run(`astats=length=${length}`);
    assert.equal(result.exitCode, status);
    assert.ok(result.stderr.includes("astats:"), result.stderr);
    assert.equal(result.output.toString(), "keep existing output");
  });
}
