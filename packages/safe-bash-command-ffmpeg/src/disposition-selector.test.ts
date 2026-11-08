import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const malformed = ["garbage", "a:garbage", "v:garbage", "a:-1", "a:1.5", "a:0:extra", "m", "v:m"];
for (const selector of [...malformed, "99", "v:99", "a:99", "s", "d", "t", "m:language:fra", "v:m:language:fra"]) {
  const invalid = malformed.includes(selector);
  it(`validates disposition selector ${selector}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mp4", createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 1 }));
    const args = ["-y", "-i", "/in.mp4", "-c", "copy", `-disposition:${selector}`, "default", "/out.mp4"];
    const sync = evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
      (path, data) => { volume.writeFileSync(path, data); return true; });
    if (invalid) assert.equal(sync, undefined);
    else assert.equal(sync, "");
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    assert.equal(result.exitCode === 0, !invalid, Buffer.concat(errors).toString());
    if (!invalid) {
      assert.deepEqual(parseMp4(volume.readFileSync("/out.mp4") as Uint8Array).tracks.map(track => track.enabled),
        parseMp4(volume.readFileSync("/in.mp4") as Uint8Array).tracks.map(track => track.enabled));
      return;
    }
    assert.ok(Buffer.concat(errors).toString().includes(`Invalid stream specifier: ${selector}`), Buffer.concat(errors).toString());
    assert.equal(volume.existsSync("/out.mp4") && volume.statSync("/out.mp4").size > 0, false);
  });
}
