import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const png = encodeImage({
  width: 2, height: 2, data: Uint8Array.from(Array(4).fill([40, 0, 0, 255]).flat()),
  channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
}, { format: "png" }).data;

async function run(args: string[]) {
  const volume = Volume.fromJSON({
    "/work/f-01.png": Buffer.from(png), "/work/f-02.png": Buffer.from(png),
    "/work/f-04.png": Buffer.from(png), "/work/é.png": Buffer.from(png)
  });
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...args], cwd: "/work", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout, stderr, rows: stdout.trim().split("\n").filter(line => line && !line.startsWith("#")) };
}

for (const format of ["framecrc", "framemd5", "framehash"]) {
  for (const [target, names] of [
    ["f-%02d.png", ["f-01.png", "f-02.png"]],
    ["é.png", ["é.png"]]
  ] as const) {
    it(`exports image2 packet paths for ${target} in ${format} without changing payloads`, async () => {
      const output = ["-c:v", "copy", "-f", format, "pipe:1"];
      const baseline = await run(["-f", "image2", "-i", target, ...output]);
      const disabled = await run(["-f", "image2", "-export_path_metadata", "0", "-i", target, ...output]);
      const enabled = await run(["-f", "image2", "-export_path_metadata", "1", "-i", target, ...output]);
      for (const result of [baseline, disabled, enabled]) assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(disabled.rows, baseline.rows);
      assert.equal(enabled.rows.length, names.length);
      for (const [index, name] of names.entries()) {
        // FFmpeg packs Strings Metadata as NUL-terminated UTF-8 key/value pairs.
        const metadata = Buffer.from(`lavf.image2dec.source_path\0${name}\0lavf.image2dec.source_basename\0${name}\0`);
        const hash = format === "framecrc" ? "" : `, ${createHash(format === "framemd5" ? "md5" : "sha256").update(metadata).digest("hex")}`;
        assert.equal(enabled.rows[index], `${baseline.rows[index]}, S=1, ${String(metadata.length).padStart(8)}${hash}`);
      }
    });
  }
}

it("keeps path metadata on packets, not decoded PNG frames", async () => {
  const args = ["-i", "f-%02d.png", "-f", "framecrc", "pipe:1"];
  const baseline = await run(args);
  const enabled = await run(["-export_path_metadata", "1", ...args]);
  assert.equal(enabled.exitCode, 0, enabled.stderr);
  assert.deepEqual(enabled.rows, baseline.rows);
});

it("resets path export for each input", async () => {
  const result = await run(["-export_path_metadata", "1", "-i", "f-%02d.png", "-i", "f-%02d.png",
    "-map", "0:v", "-map", "1:v", "-c:v", "copy", "-f", "framecrc", "pipe:1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.rows.filter(line => line.startsWith("0,") && line.includes(", S=1,")).length, 2);
  assert.equal(result.rows.filter(line => line.startsWith("1,") && !line.includes(", S=")).length, 2);
});

for (const value of ["2", "bad"]) {
  it(`rejects invalid export_path_metadata ${value}`, async () => {
    const result = await run(["-export_path_metadata", value, "-i", "f-%02d.png", "-f", "framecrc", "pipe:1"]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("export_path_metadata"), result.stderr);
    assert.equal(result.stdout, "");
  });
}

it("falls back from synchronous execution for path metadata", () => {
  assert.equal(evalSyncFfmpeg(["-export_path_metadata", "1", "-i", "f-01.png", "-c:v", "copy", "-f", "framecrc", "pipe:1"],
    undefined, () => png, () => true), undefined);
});
