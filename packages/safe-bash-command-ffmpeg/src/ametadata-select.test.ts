import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
const tags = "frame:0    pts:0       pts_time:0\nlabel=sample\n"
  + "frame:1    pts:3       pts_time:0.000375\nlabel=sample\n"
  + "frame:2    pts:6       pts_time:0.00075\nlabel=sample\n"
  + "frame:3    pts:9       pts_time:0.001125\nlabel=sample\n";

async function run(filter: string, input = samples, channels = 1) {
  const pcm = Buffer.alloc(input.length * 2);
  input.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": pcm, "/tags": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
      "-i", "in.raw", "-af", filter, "-f", "s16le", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, stdout: Buffer.concat(stdout), tags: volume.readFileSync("/tags", "utf8") };
}

// Native FFmpeg 7.0.2: both selection outcomes succeed, and print truncates tags even with no frames.
for (const [selection, expectedPcm, expectedTags] of [
  ["", "e803d007b80ba00f88137017581b401f28231027", tags],
  [",ametadata=mode=select:key=label:value=sample", "e803d007b80ba00f88137017581b401f28231027", tags],
  [",ametadata=mode=select:key=label:value=nomatch", "", ""],
  [",ametadata=mode=select:key=missing:value=sample", "", ""],
  [",ametadata=key=label", "e803d007b80ba00f88137017581b401f28231027", tags]
]) {
  it(`selects metadata frames: ${selection || "add/print control"}`, async () => {
    const result = await run(`asetnsamples=n=3:p=0,ametadata=mode=add:key=label:value=sample${selection},ametadata=mode=print:file=tags`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expectedPcm);
    assert.equal(result.tags, expectedTags);
  });
}

it("discards untagged frames successfully", async () => {
  const result = await run("ametadata=mode=select:key=label:value=sample,ametadata=mode=print:file=tags");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.tags, "");
});

it("compacts selected stereo frames and metadata while retaining their timestamps", async () => {
  const input = [1000, -1000, 2000, 2000, 3000, -3000, 4000, 4000];
  const result = await run("asetnsamples=n=1:p=0,asetpts=PTS+8,aphasemeter=video=0,ametadata=mode=select:key=lavfi.aphasemeter.phase:value=1.000000,ametadata=mode=print:file=tags,ashowinfo", input, 2);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), "d007d007a00fa00f");
  assert.equal(result.tags, "frame:0    pts:9       pts_time:0.001125\nlavfi.aphasemeter.phase=1.000000\n"
    + "frame:1    pts:11      pts_time:0.001375\nlavfi.aphasemeter.phase=1.000000\n");
  assert.ok(result.stderr.includes("n:0 pts:9 pts_time:0.001125"), result.stderr);
  assert.ok(result.stderr.includes("n:1 pts:11 pts_time:0.001375"), result.stderr);
});

it("requires a selection key before replacing the tag file", async () => {
  const result = await run("ametadata=mode=select:value=sample,ametadata=mode=print:file=tags");
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("ametadata: mode=select requires key"), result.stderr);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.tags, "KEEP");
});
