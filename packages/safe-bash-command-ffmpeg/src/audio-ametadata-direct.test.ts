import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(direct: string) {
  const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
  const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "in.raw",
      "-af", `asetnsamples=n=3:p=0,ametadata=mode=add:key=label:value=sample,ametadata=mode=print:key=label:file=tags${direct}`,
      "-f", "s16le", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, volume, input, stdout: Buffer.concat(output), stderr };
}

for (const direct of ["", ":direct=0", ":direct=1", ":direct=false", ":direct=TRUE"]) {
  it(`matches native ametadata file contents and PCM with ${direct || "default buffering"}`, async () => {
    const result = await run(direct);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, result.input);
    // FFmpeg 7.0.2: completed output is identical for either buffering setting.
    assert.equal(result.volume.readFileSync("/tags", "utf8"),
      "frame:0    pts:0       pts_time:0\nlabel=sample\n" +
      "frame:1    pts:3       pts_time:0.000375\nlabel=sample\n" +
      "frame:2    pts:6       pts_time:0.00075\nlabel=sample\n" +
      "frame:3    pts:9       pts_time:0.001125\nlabel=sample\n");
  });
}

for (const direct of ["2", "-1", "invalid"]) {
  it(`rejects direct=${direct} without replacing the tag file or emitting PCM`, async () => {
    const result = await run(`:direct=${direct}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("ametadata: invalid direct"), result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/tags", "utf8"), "KEEP");
  });
}
