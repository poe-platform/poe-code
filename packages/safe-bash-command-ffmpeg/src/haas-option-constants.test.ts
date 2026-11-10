import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(option: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: 2 }, (_, channel) => Float64Array.from({ length: 1536 },
      (_, frame) => ((frame * 421 + channel * 1709) % 12000 - 6000) / 32768)) }));
  let stderr = "";
  const filter = `haas=${option}`;
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2 output for the PCM16 stereo input above.
  for (const [option, numeric, hash] of [
    ["level_in=max", "level_in=64", "ca18204565c0cc7e87412883de1a8bf8dbf16ab3f5a1c0783fe8a4d00f51ad8a"],
    ["left_balance=max", "left_balance=1", "1168daff827de1041a12d22a5025e7f7e49515f1ad2da43d80ebf1d3f005fb21"],
    ["level_in=min", "level_in=0.015625", "a5b75e5d915d432493f2e17133ebc0533f71c305f9153464ab9b2e7ca4c6287f"],
    ["side_gain=default", "side_gain=1", "ec2a6dc16866fc95105c82681d94ccd18a9f775f91dc25b3ad74b4e88305c294"]
  ] as const) {
    it(`haas ${option} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      for (const value of [numeric, option]) {
        const result = await render(value, graph);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.output.length, 6144);
        assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
      }
    });
  }

  for (const [name, min, max, defaultValue] of [
    ["level_in", 0.015625, 64, 1], ["level_out", 0.015625, 64, 1],
    ["side_gain", 0.015625, 64, 1], ["middle_source", 0, 3, 2],
    ["left_delay", 0, 40, 2.05], ["left_balance", -1, 1, -1], ["left_gain", 0.015625, 64, 1],
    ["right_delay", 0, 40, 2.12], ["right_balance", -1, 1, 1], ["right_gain", 0.015625, 64, 1]
  ] as const) {
    it(`haas ${name} resolves its own bounds and original default (${graph ? "graph" : "simple"})`, async () => {
      for (const [constant, value] of [["min", min], ["max", max], ["default", defaultValue]] as const) {
        const actual = await render(`${name}=${max}:${name}=${constant}`, graph);
        const expected = await render(`${name}=${value}`, graph);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.equal(expected.exitCode, 0, expected.stderr);
        assert.deepEqual(actual.output, expected.output);
      }
    });
  }

  it(`haas resolves constants in positional expressions (${graph ? "graph" : "simple"})`, async () => {
    const actual = await render("max/2:default:min*2:default:0:default:min:default:0:default:max:default:1", graph);
    const expected = await render("32:1:0.03125:2:0:2.05:-1:1:0:2.12:1:1:1", graph);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(expected.exitCode, 0, expected.stderr);
    assert.deepEqual(actual.output, expected.output);
  });

  for (const option of ["level_in=max+1", "left_balance=min-1", "right_delay=max+1", "side_gain=default/0", "level_out=unknown"]) {
    it(`haas ${option} preserves existing output on failure (${graph ? "graph" : "simple"})`, async () => {
      const result = await render(option, graph);
      assert.notEqual(result.exitCode, 0, result.stderr);
      assert.ok(result.stderr.includes("haas:"), result.stderr);
      assert.equal(result.output.toString(), "KEEP");
    });
  }
}
