import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) for (const stereo of [false, true]) {
  it(`aexciter selects whole frames and keeps history while disabled (${graph ? "graph" : "simple"}, ${stereo ? "stereo" : "mono"})`, async () => {
    const dry = await run("anull", graph, stereo);
    const wet = await run("asetnsamples=n=64:p=0,aexciter", graph, stereo);
    assert.notDeepEqual(wet.pcm, dry.pcm);
    for (const [expression, active] of [
      ["0", [false, false, false, false]],
      ["1", [true, true, true, true]],
      ["gte(n,2)", [false, false, true, true]],
      ["mod(n,2)", [false, true, false, true]],
      ["gte(t,0.002)", [false, false, true, true]],
      ["gte(st(0,ld(0)+1),5)", [false, false, true, true]],
      ["-0.5", [true, true, true, true]],
      ["0.49", [false, false, false, false]]
    ] as const) {
      const output = await run(`asetnsamples=n=64:p=0,aexciter=enable='${expression}'`, graph, stereo);
      assert.equal(output.pcm.length, 256 * 2 * (stereo ? 2 : 1));
      if (expression === "gte(n,2)") {
        // Native FFmpeg 7.0.2 output for the reported fixture and a second independent channel.
        assert.equal(createHash("sha256").update(output.pcm).digest("hex"), stereo
          ? "d6b6754bec242909c1357167199b691afe567c90178ba24fbbc1bff681af23e2"
          : "633f582d951bfe15bce2eeafae1de5e56164d6fad4a4ba90e0a79eac5352fc32");
      }
      const frameBytes = 64 * 2 * (stereo ? 2 : 1);
      for (const [n, enabled] of active.entries()) {
        assert.deepEqual(output.pcm.subarray(n * frameBytes, (n + 1) * frameBytes),
          (enabled ? wet : dry).pcm.subarray(n * frameBytes, (n + 1) * frameBytes), `${expression}, frame ${n}`);
      }
    }
  });
}

it("aexciter uses shifted timestamps and preserves a partial final frame", async () => {
  const dry = await run("anull");
  const wet = await run("aexciter=level_in=0.7:level_out=0.8:amount=2:listen=1");
  const output = await run("asetnsamples=n=70:p=0,asetpts=PTS+48000,aexciter=level_in=0.7:level_out=0.8:amount=2:listen=1:enable='gte(t,1.002)'");
  assert.equal(output.pcm.length, 512);
  assert.deepEqual(output.pcm.subarray(0, 280), dry.pcm.subarray(0, 280));
  assert.deepEqual(output.pcm.subarray(280), wet.pcm.subarray(280));
});

it("aexciter applies scheduled parameters while disabled", async () => {
  const dry = await run("anull");
  const output = await run("asetnsamples=n=64:p=0,asendcmd=c='0.002 aexciter level_out 0',aexciter=enable='gte(n,3)'");
  assert.deepEqual(output.pcm.subarray(0, 384), dry.pcm.subarray(0, 384));
  assert.deepEqual(output.pcm.subarray(384), Buffer.alloc(128));
});

for (const expression of ["", "unknown", "gte(n,)"]) {
  it(`aexciter rejects invalid enable=${expression} without replacing output`, async () => {
    const output = await run(`aexciter=enable='${expression}'`, false, false, false);
    assert.notEqual(output.result.exitCode, 0);
    assert.ok(output.stderr.includes("aexciter enable"), output.stderr);
    assert.equal(output.pcm.toString(), "keep");
  });
}

async function run(filter: string, graph = false, stereo = false, success = true) {
  const channels = [Float64Array.from({ length: 256 }, (_, i) => (i % 2 ? -10000 : 10000) / 32768)];
  if (stereo) channels.push(Float64Array.from({ length: 256 }, (_, i) => ((i * 53) % 12000 - 6000) / 32768));
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  if (success) {
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
  }
  return { pcm: volume.readFileSync("/out.pcm") as Buffer, result, stderr };
}
