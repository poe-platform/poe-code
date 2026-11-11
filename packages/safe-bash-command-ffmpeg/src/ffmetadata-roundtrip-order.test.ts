import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const tags of [
  "artist=Pat\ntitle=Album\n",
  "foo=1\ntitle=A\nbar=2\nartist=B\n",
  "2=A\n1=B\n",
  "title=A\nartist=B\n",
  "2=A\nARTIST=Pat\n1=B\ntitle=Album\nempty=\n"
]) {
  it(`preserves unedited global FFmetadata order (${sync ? "sync" : "async"}): ${JSON.stringify(tags)}`, async () => {
    const input = `;FFMETADATA1\n${tags}`;
    const volume = Volume.fromJSON({ "/in.meta": input });
    const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
    let output = "";
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      output = volume.readFileSync("/out.meta", "utf8") as string;
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
    }
    assert.equal(output, input);
  });
}
