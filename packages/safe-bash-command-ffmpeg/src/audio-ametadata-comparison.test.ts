import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
// FFmpeg 7.0.2: ten mono PCM16 samples at 8 kHz, reframed into three samples.
const report = "frame:0    pts:0       pts_time:0\nlabel=sample\n"
  + "frame:1    pts:3       pts_time:0.000375\nlabel=sample\n"
  + "frame:2    pts:6       pts_time:0.00075\nlabel=sample\n"
  + "frame:3    pts:9       pts_time:0.001125\nlabel=sample\n";

async function run(comparison: string) {
  const volume = Volume.fromJSON({ "/in.raw": pcm, "/tags": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      "-af", `asetnsamples=n=3:p=0,ametadata=mode=add:key=label:value=sample,ametadata=mode=print:key=label:${comparison}:file=tags`,
      "-f", "s16le", "-"],
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

for (const [comparison, matches] of [
  ["value=sam:function=starts_with", true],
  ["value=ple:function=ends_with", true],
  ["value=ple:function=starts_with", false],
  ["value=sam:function=ends_with", false],
  ["value=Sample:function=starts_with", false],
  ["value=Sample:function=ends_with", false],
  ["value=sample:function=starts_with", true],
  ["value=sample:function=ends_with", true],
  ["value=samples:function=starts_with", false],
  ["value=samples:function=ends_with", false],
  ["value=:function=starts_with", true],
  ["value=:function=ends_with", true],
  ["value=sam", false],
  ["value=sample", true],
  ["value=sam:function=same_str", false],
  ["value=sample:function=same_str", true],
  ["function=starts_with", true],
  ["function=ends_with", true]
] as const) {
  it(`ametadata print ${comparison} preserves PCM and ${matches ? "prints" : "omits"} frame tags`, async () => {
    const result = await run(comparison);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, pcm);
    assert.equal(result.tags, matches ? report : "");
  });
}

it("rejects unsupported metadata comparisons before replacing tags or writing PCM", async () => {
  const result = await run("value=sam:function=unknown");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.tags, "KEEP");
  assert.ok(result.stderr.includes("ametadata:"));
});
