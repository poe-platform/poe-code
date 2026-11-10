import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [options, hash] of [
  ["mode=triangle", "e157038f29c75fe7f9de3a35382f66bf27a8819b354459b83aae76c2a91bbd98"],
  ["amount=0.5", "9f2a770303488c8b66a9044f636e8ec205b103c9a369444b139bd931a71b8298"]
]) {
  for (const graph of [false, true]) {
    for (const suffix of ["", ":"]) {
      it(`apulsator=${options}${suffix} matches all native PCM frames (${graph ? "graph" : "simple"})`, async () => {
        const { result, stderr, bytes } = await run(options + suffix, graph);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(bytes.length, 128);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      });
    }
  }
}

for (const options of ["amount=", "mode=", "amount=0.5::", "1::0.5"]) {
  it(`apulsator=${options} still rejects empty values without replacing output`, async () => {
    const { result, bytes } = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.equal(bytes.toString(), "keep");
  });
}

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(32).fill(10000 / 32768),
    new Float64Array(32).fill(-8000 / 32768)
  ] }));
  let stderr = "";
  const filter = `apulsator=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
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
  return { result, stderr, bytes: volume.readFileSync("/out.raw") as Buffer };
}
