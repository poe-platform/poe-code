import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const dry = "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05";
const gated = "4c54564d6f8afc06ad9ddbb2805252a2a2b44e0508641460ff14de8328ed8cbb";
const wet = "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de";

async function run(filter: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(8192).fill(0.25)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/tone.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
  const pcm = volume.readFileSync("/out.raw") as Buffer;
  assert.equal(pcm.length, 16384);
  return pcm;
}

// Native FFmpeg 7.0.2 output for the reported 8192-sample mono fixture.
for (const [filter, hash] of [
  ["asendcmd=c=0.0 tremolo enable 0,tremolo", dry],
  ["asendcmd=c=0.256 tremolo enable 0,tremolo", gated],
  ["asendcmd=c=0.256 tremolo@one enable 0,tremolo@one", gated],
  ["anull", dry],
  ["tremolo=enable=lt(t\\,0.256)", gated],
  ["tremolo", wet]
]) {
  for (const graph of [false, true]) it(`${filter} matches native PCM (graph ${graph})`, async () => {
    assert.equal(createHash("sha256").update(await run(filter!, graph)).digest("hex"), hash);
  });
}

for (const graph of [false, true]) {
  for (const [scheduled, direct] of [
    ["asendcmd=c='0 tremolo enable 0;0.256 tremolo enable 1',tremolo", "tremolo=enable=gte(t\\,0.256)"],
    ["asendcmd=c='0 tremolo enable 0;0.256 tremolo enable invalid',tremolo", "anull"],
    ["asendcmd=c='0 tremolo enable 0',tremolo,tremolo", "tremolo"],
    ["asendcmd=c='0 tremolo@two enable 0',tremolo@one,tremolo@two", "tremolo"],
    ["asendcmd=c='0 tremolo@missing enable 0',tremolo", "tremolo"]
  ]) it(`routes and applies ${scheduled} (graph ${graph})`, async () => {
    assert.deepEqual(await run(scheduled!, graph), await run(direct!, graph));
  });
}
