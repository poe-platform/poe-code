import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const source = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-picture-types.mp4", import.meta.url));

async function run(extra: string[], output = "/out.mkv", limits = {}) {
  const volume = Volume.fromJSON({ "/a.txt": "Notes for track A\n", "/b.txt": "Notes for track B\n" });
  volume.writeFileSync("/in.mp4", source);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-i", "/in.mp4", "-map", "0:v", "-c", "copy", ...extra, output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

it("adds two named Matroska attachments with distinct original payloads", async () => {
  const { result, volume, error } = await run([
    "-attach", "a.txt", "-metadata:s:t:0", "mimetype=text/plain",
    "-attach", "b.txt", "-metadata:s:t:1", "mimetype=text/plain"
  ]);
  assert.equal(result.exitCode, 0, error);
  const output = volume.readFileSync("/out.mkv") as Buffer;
  const doc = parseMkv(output);
  assert.equal(doc.tracks.length, 1);
  assert.deepEqual(doc.attachments.map(file => file.tags), [
    { filename: "a.txt", mimetype: "text/plain" }, { filename: "b.txt", mimetype: "text/plain" }
  ]);
  assert.deepEqual(doc.attachments.map(file => Buffer.from(file.data).toString()), ["Notes for track A\n", "Notes for track B\n"]);
  if (spawnSync("ffprobe", ["-version"]).status === 0) {
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_data", "-of", "json", "pipe:0"], { input: output });
    assert.equal(probe.status, 0, probe.stderr.toString());
    const files = JSON.parse(probe.stdout.toString()).streams.filter((s: { codec_type: string }) => s.codec_type === "attachment");
    assert.deepEqual(files.map((s: { tags: unknown }) => s.tags), doc.attachments.map(file => file.tags));
    assert.deepEqual(files.map((s: { extradata_size: number }) => s.extradata_size), [18, 18]);
    if (spawnSync("ffmpeg", ["-version"]).status === 0) {
      for (const [ordinal, content] of ["Notes for track A\n", "Notes for track B\n"].entries()) {
        const extraction = spawnSync("ffmpeg", ["-v", "error", `-dump_attachment:t:${ordinal}`, "pipe:1", "-i", "pipe:0", "-map", "0:v", "-c", "copy", "-f", "null", "-"], { input: output });
        assert.equal(extraction.status, 0, extraction.stderr.toString());
        assert.equal(extraction.stdout.toString(), content);
      }
    }
  }
});

it("applies filename overrides and absolute output stream metadata", async () => {
  const { result, volume, error } = await run(["-attach", "a.txt", "-metadata:s:1", "mimetype=text/plain", "-metadata:s:t", "filename=notes.txt"]);
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(parseMkv(volume.readFileSync("/out.mkv") as Buffer).attachments[0]!.tags, { filename: "notes.txt", mimetype: "text/plain" });
});

for (const [args, output] of [
  [["-attach", "missing.txt"], "/out.mkv"],
  [["-attach", "a.txt"], "/out.mkv"],
  [["-attach", "a.txt", "-metadata:s:t", "mimetype=text/plain"], "/out.mp4"]
] as const) {
  it(`rejects unavailable attachment or unsupported container: ${args.join(" ")} ${output}`, async () => {
    const { result, volume } = await run([...args], output);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.existsSync(output), false);
  });
}

it("keeps attachments scoped to their output", async () => {
  const { result, volume, error } = await run(["-attach", "a.txt", "-metadata:s:t", "mimetype=text/plain", "/first.mkv", "-map", "0:v", "-c", "copy"]);
  assert.equal(result.exitCode, 0, error);
  assert.equal(parseMkv(volume.readFileSync("/first.mkv") as Buffer).attachments.length, 1);
  assert.equal(parseMkv(volume.readFileSync("/out.mkv") as Buffer).attachments.length, 0);
});

it("charges attachment bytes to the input budget", async () => {
  const { result, volume } = await run(["-attach", "a.txt", "-metadata:s:t", "mimetype=text/plain"], "/out.mkv", { maxInputBytes: source.length + 17 });
  assert.notEqual(result.exitCode, 0);
  assert.equal(volume.existsSync("/out.mkv"), false);
});
