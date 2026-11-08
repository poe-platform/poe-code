import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const source = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url));
const doc = parseMp4(source);
const attachmentData = [Buffer.from("Notes for track A\n"), Buffer.from("Notes for track B\n")];
const mkv = serializeMkv({ ...doc, attachments: attachmentData.map((data, i) => ({
  data, size: data.length, tags: { filename: `${i}.txt`, mimetype: "text/plain" }
})) });

async function run(args: string[], existing = false, limits = {}) {
  const volume = new Volume();
  volume.writeFileSync("/in.mp4", source);
  volume.writeFileSync("/in.mkv", mkv);
  if (existing) volume.writeFileSync("/dump.bin", "keep me");
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits }).execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
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

for (const ordinal of [0, 1]) {
  it(`extracts attachment t:${ordinal} independently of the output map`, async () => {
    const { result, volume, error } = await run([`-dump_attachment:t:${ordinal}`, "dump.bin", "-i", "in.mkv", "-map", "0:v", "-c", "copy", "out.mkv"]);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(volume.readFileSync("/dump.bin"), attachmentData[ordinal]);
    const output = parseMkv(volume.readFileSync("/out.mkv") as Buffer);
    assert.deepEqual(output.tracks.map(track => track.type), ["video"]);
    assert.equal(output.attachments.length, 0);
  });
}

for (const [specifier, expected] of [["v:0", doc.tracks[0]!.codecDescriptions[0]!.avcC!.rawBytes], ["a:0", doc.tracks[1]!.codecDescriptions[0]!.esds!.decoderSpecificInfo]] as const) {
  it(`extracts exact MP4 ${specifier} codec initialization bytes`, async () => {
    const { result, volume, error } = await run([`-dump_attachment:${specifier}`, "dump.bin", "-i", "in.mp4", "-map", "0:v", "-c", "copy", "out.mkv"]);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(volume.readFileSync("/dump.bin"), Buffer.from(expected));
    assert.equal(expected.length, specifier === "v:0" ? 46 : 5);
  });
}

it("uses attachment filenames for an empty destination and keeps requests scoped to the next input", async () => {
  const { result, volume, error } = await run(["-dump_attachment:t", "", "-i", "in.mkv", "-i", "in.mkv", "-map", "0:v", "-c", "copy", "out.mkv", "-map", "0:v", "-c", "copy", "second.mkv"]);
  assert.equal(result.exitCode, 0, error);
  for (const i of [0, 1]) assert.deepEqual(volume.readFileSync(`/${i}.txt`), attachmentData[i]);
});

it("protects existing dump files unless -y is supplied", async () => {
  const args = ["-dump_attachment:t:0", "dump.bin", "-i", "in.mkv", "-map", "0:v", "-c", "copy", "out.mkv"];
  const refused = await run(args, true);
  assert.notEqual(refused.result.exitCode, 0);
  assert.equal(refused.volume.readFileSync("/dump.bin").toString(), "keep me");
  const replaced = await run(["-y", ...args], true);
  assert.equal(replaced.result.exitCode, 0, replaced.error);
  assert.deepEqual(replaced.volume.readFileSync("/dump.bin"), attachmentData[0]);
});

it("rejects malformed selectors without writing a dump", async () => {
  const { result, volume } = await run(["-dump_attachment:t:no", "dump.bin", "-i", "in.mkv", "-c", "copy", "out.mkv"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(volume.existsSync("/dump.bin"), false);
});

it("enforces the media output byte limit before writing attachments", async () => {
  const { result, volume } = await run(["-dump_attachment:t:0", "dump.bin", "-i", "in.mkv", "-map", "0:v", "-c", "copy", "out.mkv"], false, { maxOutputBytes: 17 });
  assert.notEqual(result.exitCode, 0);
  assert.equal(volume.existsSync("/dump.bin"), false);
});
