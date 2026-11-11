import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { declickAudio } from "./audio-adeclick.js";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 s16le references for the same four-sample WAV.
for (const [filter, expected] of [
  ["adeclick=w=20+5", "fcfff9ff5802f8ff"],
  ["adeclip=w=20+5", "fcfff9ff5802f8ff"],
  ["adeclip=t=default", "fefffdff1101fcff"]
] as const) for (const graph of [false, true]) {
  it(`evaluates ${filter} through the ${graph ? "graph" : "simple"} command path`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from([-600, -500, 30000, -300], value => value / 32768)] }));
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}

const channels = [Float64Array.from({ length: 256 }, (_, i) => i % 17 === 0 ? 0.9 : Math.sin(i) / 10)];
for (const name of ["adeclick", "adeclip"]) {
  for (const [expression, numeric] of [
    ["window=20+5:overlap=100-25:arorder=2*2:threshold=6/2:method=save-add", "w=25:o=75:a=4:t=3:m=1"],
    ["min+15:max-20:min+4:min+2:default:s-a", "25:75:4:3:" + (name === "adeclip" ? "1000" : "2") + ":1"],
    ["w=25:w=default:o=50:o=default:a=3:a=default:t=3:t=default:m=save:m=default", ""],
    [name === "adeclip" ? "n=100*5:n=default" : "b=2*2:b=default", ""],
    ["t=PI", `t=${Math.PI}`]
  ]) it(`${name} matches numeric options for ${expression}`, async () => {
    const actual = await declickAudio(channels, 8000, `${name}=${expression}`, new MediaBudgetTracker());
    const expected = await declickAudio(channels, 8000, `${name}=${numeric}`, new MediaBudgetTracker());
    assert.deepEqual(actual, expected);
  });

  for (const value of ["min-1", "max+1", "1/0", "0/0", "unknown", "20+"]) {
    it(`${name} rejects invalid window expression ${value}`, async () => {
      await assert.rejects(declickAudio(channels, 8000, `${name}=w=${value}`, new MediaBudgetTracker()));
    });
  }
}
