import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { flacAst, oggAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const pcm = Buffer.alloc(4096 * 4);
for (let i = 0; i < 4096; i++) {
  const x = i * 149 % 30000 - 15000;
  pcm.writeInt16LE(x, i * 4);
  pcm.writeInt16LE(x + i % 31 - 15, i * 4 + 2);
}

for (const sync of [false, true]) for (const extension of ["flac", "ogg"]) {
  it(`${sync ? "sync" : "async"} ${extension} honors Cholesky passes and preserves PCM`, async () => {
    const outputs: Buffer[] = [];
    for (const passes of [undefined, "1", "2", "3", "0", "-1", "1.5", "NaN", "2147483648", ""]) {
      const valid = passes === undefined || ["1", "2", "3"].includes(passes);
      const volume = Volume.fromJSON({ "/in.pcm": pcm });
      const args = ["-y", "-f", "s16le", "-ar", "16000", "-ac", "2", "-i", "/in.pcm",
        "-c:a", "flac", ...(passes === undefined ? [] : ["-lpc_passes", passes]),
        "-lpc_type", "cholesky", `/out.${extension}`];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, valid ? "" : undefined, `passes=${passes}`);
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode === 0, valid, stderr);
      }
      if (!valid) { assert.equal(volume.existsSync(`/out.${extension}`), false); continue; }
      const bytes = volume.readFileSync(`/out.${extension}`) as Buffer;
      const flac = extension === "flac" ? bytes : Buffer.from(oggAst().parse(bytes).tracks[0]!.samples[0]!.data);
      const doc = flacAst().parse(flac, { decodeAudio: true });
      outputs.push(Buffer.concat(doc.tracks[0]!.samples.map(sample => sample.data)));
      const decoded = doc.tracks[0]!.decodedAudio!;
      assert.equal(decoded.channelData[0]!.length, 4096);
      for (let i = 0; i < 4096; i++) for (let channel = 0; channel < 2; channel++) {
        assert.equal(Math.round(decoded.channelData[channel]![i]! * 32768), pcm.readInt16LE(i * 4 + channel * 2));
      }
    }
    assert.deepEqual(outputs[0], outputs[2], "default is two passes");
    assert.notDeepEqual(outputs[1], outputs[2], "second pass changes prediction");
    assert.notDeepEqual(outputs[2], outputs[3], "third pass changes prediction");
  });
}
