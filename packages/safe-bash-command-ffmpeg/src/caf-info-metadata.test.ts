import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independently constructed CAF: 8000 Hz mono LPCM, two info tags, four samples.
// This deliberately does not use the CAF writer to construct input metadata.
const caf = Buffer.from(
  "636166660001000064657363000000000000002040bf4000000000006c70636d0000000000000002000000010000000100000010" +
  "696e666f000000000000001d000000027469746c65004576656e696e6700617274697374004b617900" +
  "64617461000000000000000c00000000640038ff2c0170fe", "hex");

for (const sync of [false, true]) {
  it(`exports CAF info title and artist as FFmetadata (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.caf", caf);
    const args = ["-v", "error", "-y", "-i", "/in.caf", "-f", "ffmetadata", "/out.txt"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
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
    const lines = volume.readFileSync("/out.txt", "utf8").toString().trim().split("\n")
      .filter(line => !line.startsWith("encoder="));
    assert.equal(lines[0], ";FFMETADATA1");
    assert.deepEqual(lines.slice(1).sort(), ["artist=Kay", "title=Evening"]);
    assert.deepEqual(volume.readFileSync("/in.caf"), caf);
  });
}
