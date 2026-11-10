import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: -f lavfi -i color=black:s=128x96:d=1:r=2 -pix_fmt yuv420p
const source = readFileSync(new URL("./fixtures/filter-file-black.mp4", import.meta.url));
const filter = "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill";

function setup() {
  const volume = Volume.fromJSON({ "/work/f.txt": filter });
  volume.writeFileSync("/work/in.mp4", source);
  async function run(args: string[]) {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/work", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    return { ...result, stderr };
  }
  return { volume, run };
}

for (const options of [["-vf", filter], ["-/filter:v", "f.txt"], ["-/filter:v", "/work/f.txt"]]) {
  it(`applies ${options.join(" ")} to all 12,288 pixels`, async () => {
    const { volume, run } = setup();
    const encoded = await run(["-i", "in.mp4", ...options, "-c:v", "libx264", "file.mp4"]);
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    const decoded = await run(["-i", "file.mp4", "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "frame.gray"]);
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(volume.readFileSync("/work/frame.gray"), Buffer.alloc(128 * 96, 255));
  });
}

it("identifies a missing filter file without writing unfiltered output", async () => {
  const { volume, run } = setup();
  const result = await run(["-i", "in.mp4", "-/filter:v", "missing.txt", "-c:v", "libx264", "file.mp4"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("missing.txt"), result.stderr);
  assert.equal(volume.existsSync("/work/file.mp4"), false);
});

it("requires a filter filename", async () => {
  const { run } = setup();
  const result = await run(["-i", "in.mp4", "-/filter:v"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("requires a filename"), result.stderr);
});
