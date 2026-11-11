import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: [input options] -i aac-tail.m4a [output options]
// -c:a pcm_s16le -f s16le out.pcm. Reference hashes cover every output sample.
const fullHash = "e3014ab984225d665fdc70655fcc300f7903f971268c3f0d77bce94031a7a142";
const limitedHash = "1806f6e2bcbbbe1eabe60a0fadc6b147103cb7eec1cebf69317daabcd35dad81";
const cases = [
  { name: "unrestricted", input: [], output: [], bytes: 4096, hash: fullHash },
  { name: "input duration", input: ["-t", "0.2"], output: [], bytes: 3200, hash: limitedHash },
  { name: "output duration", input: [], output: ["-t", "0.2"], bytes: 3200, hash: limitedHash },
  { name: "output end", input: [], output: ["-to", "0.2"], bytes: 3200, hash: limitedHash },
  { name: "empty output", input: [], output: ["-t", "0"], bytes: 0,
    hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  { name: "seek into tail", input: [], output: ["-ss", "0.2"], bytes: 896,
    hash: "39ea2db3f0c4c41daef0cb791ccc43f3f645c8936e07b3fddf5d452c3a44ce93" },
  { name: "seek relative to container end", input: ["-sseof", "-0.1"], output: [], bytes: 2496,
    hash: undefined }, // Input seeking restarts the decoder; compare the duration here.
  { name: "identity filter", input: [], output: ["-af", "anull"], bytes: 4096, hash: fullHash }
];
for (const sync of [false, true]) {
  for (const test of cases.filter(test => !sync || !test.output.some(arg => arg === "-af"))) {
    it(`preserves AAC decoded samples (${sync ? "sync" : "async"}, ${test.name})`, async () => {
      const volume = Volume.fromJSON({
        "/in.m4a": readFileSync(new URL("./fixtures/aac-tail.m4a", import.meta.url))
      });
      const args = ["-y", "-v", "error", ...test.input, "-i", "/in.m4a", ...test.output,
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), test.output.length ? undefined : "");
        if (test.output.length) assert.equal(volume.existsSync("/out.pcm"), false);
      }
      if (!sync || test.output.length) {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, test.bytes);
      if (test.hash) assert.equal(createHash("sha256").update(output).digest("hex"), test.hash);
    });
  }
}
