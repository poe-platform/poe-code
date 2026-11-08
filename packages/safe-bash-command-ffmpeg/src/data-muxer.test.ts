import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function copy(maps: string[], target = "/out.mov", maxOutputBytes?: number) {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/timecode.mp4", import.meta.url));
  const volume = Volume.fromJSON({ "/in.mp4": input });
  let stderr = "";
  const stdout: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-v", "error", "-y", "-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "-f", "data", target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, input, stdout: Buffer.concat(stdout) };
}

for (const target of ["/out.mov", "pipe:1"]) {
  it(`writes only the selected timecode packet to ${target}`, async () => {
    const { result, stderr, volume, stdout } = await copy(["0:1"], target);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(target === "pipe:1" ? stdout : volume.readFileSync(target), Buffer.from([0, 1, 0x6b, 0x97]));
  });
}

it("concatenates all selected video packets without a container header", async () => {
  const { result, stderr, volume, input } = await copy(["0:0"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/out.mov"), Buffer.concat(parseMp4(input).tracks[0]!.samples.map(sample => sample.data)));
});

it("rejects multiple streams without writing output", async () => {
  const { result, stderr, volume } = await copy(["0"]);
  assert.equal(result.exitCode, 1);
  assert.match(stderr, /exactly one stream/);
  assert.equal(volume.existsSync("/out.mov"), false);
});

it("enforces output limits before writing packets", async () => {
  const { result, stderr, volume } = await copy(["0:1"], "/out.mov", 3);
  assert.equal(result.exitCode, 1);
  assert.match(stderr, /maxOutputBytes/);
  assert.equal(volume.existsSync("/out.mov"), false);
});
