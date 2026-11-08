import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { mp4Ast } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 0.5s 16 kHz sine -> AAC, then stream-copy a 16x16 testsrc PNG
// with -map 0:a -map 1:v -c copy -disposition:v:0 attached_pic.
const input = readFileSync(new URL("./fixtures/m4a-cover.m4a", import.meta.url));
const art = mp4Ast().parse(input).metadata.coverArt!.data;

const plain = mp4Ast().serialize({ ...mp4Ast().parse(input), tracks: mp4Ast().parse(input).tracks.filter(track => track.type === "audio") });

it("attaches a separate PNG as M4A cover metadata without changing encoded packets", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/plain.m4a", plain);
  volume.writeFileSync("/cover.png", art);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/plain.m4a", "-i", "/cover.png",
      "-map", "0:a", "-map", "1:v", "-c", "copy", "-disposition:v:0", "attached_pic", "/out.m4a"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = mp4Ast().parse(volume.readFileSync("/out.m4a") as Buffer);
  assert.equal(output.tracks.length, 2);
  const [audio, picture] = output.tracks;
  assert.equal(audio!.samples.length, 9);
  assert.deepEqual(audio!.samples.map(sample => Buffer.from(sample.data)),
    mp4Ast().parse(plain).tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
  assert.equal(picture!.disposition?.attached_pic, 1);
  assert.equal(picture!.codecDescriptions[0]!.codecName, "png");
  assert.equal(picture!.samples.length, 1);
  assert.deepEqual(Buffer.from(picture!.samples[0]!.data), Buffer.from(art));
  assert.equal(output.metadata.coverArt?.mimeType, "image/png");
  assert.deepEqual(Buffer.from(output.metadata.coverArt!.data), Buffer.from(art));
});

it("extracts the original PNG packet through the first video stream map", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/art.m4a", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/art.m4a", "-map", "0:v:0", "-c:v", "copy", "/out.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const png = volume.readFileSync("/out.png") as Buffer;
  assert.equal(png.length, 219);
  assert.equal(createHash("sha256").update(png).digest("hex"),
    "64c128ecc4e8795d71a95f8eacdb4f755326f45b1fb4361b368d6d5147f766d1");
});

for (const [source, selection, keep] of [[input, [], true], [input, ["-map", "0"], true], [input, ["-map", "0:a"], false], [input, ["-vn"], false], [plain, [], false]] as const) {
  it(`copies ${source === plain ? "plain" : "illustrated"} M4A with selection ${selection.join(" ") || "automatic"}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.m4a", source);
    const args = ["-v", "error", "-i", "/in.m4a", ...selection, "-c", "copy", "/out.m4a"];
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
    const bytes = volume.readFileSync("/out.m4a") as Buffer;
    const resultDoc = mp4Ast().parse(bytes);
    const picture = resultDoc.tracks.find(track => track.disposition?.attached_pic === 1);
    assert.equal(Boolean(picture), keep);
    assert.equal(Boolean(resultDoc.metadata.coverArt), keep);
    if (keep) {
      assert.deepEqual(Buffer.from(picture!.samples[0]!.data), Buffer.from(art));
      assert.equal(picture!.codecDescriptions[0]!.codecName, "png");
      assert.equal(picture!.width, 16);
      assert.equal(picture!.height, 16);
    }
    assert.deepEqual(resultDoc.tracks[0]!.samples.map(sample => Buffer.from(sample.data)),
      mp4Ast().parse(input).tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
  });
}
