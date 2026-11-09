import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string) {
  const volume = Volume.fromJSON({});
  for (const [name, length] of [["a", 1301], ["b", 37]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length }, (_, i) => (i % 16 - 8) / 32)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", graph,
      "-map", "[out]", "-f", "s16le", "/out.pcm"],
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
  return volume.readFileSync("/out.pcm");
}

for (const expression of ["eq(n\\,0)", "'eq(n,0)'"]) {
  for (const filter of ["acrossfade=ns=37", "axcorrelate=128:best", "amerge",
    "amultiply", "amix", "sidechaingate", "sidechaincompress", "astreamselect=map=0",
    "join=channel_layout=stereo:map=0.0-FL|1.0-FR"]) {
    it(`preserves aselect=${expression} and subsequent filters after ${filter}`, async () => {
      const graph = (selection: string) => `[0:a][1:a]${filter},aselect=${selection},volume=0.5[out]`;
      const expected = await run(graph("not(n)"));
      assert.ok(expected.length > 0);
      assert.deepEqual(await run(graph(expression)), expected);
    });
  }

  it(`preserves aselect=${expression} before asplit and anullsink`, async () => {
    const graph = (selection: string) => `[0:a]aselect=${selection},asplit[a][b];` +
      `[a]volume=0.5[out];[b]aselect=${selection},anullsink`;
    const expected = await run(graph("not(n)"));
    assert.ok(expected.length > 0);
    assert.deepEqual(await run(graph(expression)), expected);
  });
}
