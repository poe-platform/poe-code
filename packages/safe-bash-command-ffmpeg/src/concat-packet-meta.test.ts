import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, mp4Ast, parseMp4, type MediaDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(manifest: string) {
  const inputs = [0, 120].map(red => createSyntheticMp4({
    width: 16, height: 16, fps: 5, frameCount: 10, color: [red, 40, 80]
  }));
  const volume = Volume.fromJSON({
    "/a.mp4": Buffer.from(inputs[0]!), "/b.mp4": Buffer.from(inputs[1]!),
    "/list.ffconcat": manifest, "/out.mp4": "keep"
  });
  let stderr = "";
  let document: MediaDocument | undefined;
  const plugin = mp4Ast();
  const result = await createFfmpegCommand({ asts: [{ ...plugin, serialize(doc, options) {
    document = doc;
    return plugin.serialize(doc, options);
  } }] }).execute({
    args: ["-y", "-f", "concat", "-i", "/list.ffconcat", "-c", "copy", "/out.mp4"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, document, output: volume.readFileSync("/out.mp4") as Buffer };
}

for (const directives of ["file_packet_meta camera left", "file_packet_meta camera old\nfile_packet_meta camera left\nfile_packet_meta 'view name' 'front left'", "file_packet_meta camera left\nduration 2", "duration 2\nfile_packet_meta camera left"]) {
  it(`keeps concat packet metadata local to its file: ${directives}`, async () => {
    const control = await run("ffconcat version 1.0\nfile a.mp4\nfile b.mp4\n");
    const actual = await run(`ffconcat version 1.0\nfile a.mp4\n${directives}\nfile b.mp4\n`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.output, control.output);
    const samples = actual.document!.tracks[0]!.samples;
    assert.equal(samples.length, 20);
    const tags = directives.includes("view name") ? { camera: "left", "view name": "front left" } : { camera: "left" };
    assert.deepEqual(samples.map(sample => sample.tags), [...Array(10).fill(tags), ...Array(10).fill(undefined)]);
    assert.deepEqual(parseMp4(actual.output).tracks[0]!.samples.map(s => s.pts / 90000), Array.from({ length: 20 }, (_, i) => i / 5));
  });
}

for (const [manifest, error] of [
  ["file_packet_meta camera left\nfile a.mp4\n", "file_packet_meta without file"],
  ["file a.mp4\nfile_packet_meta camera\n", "string required"],
  ["file a.mp4\nfile_packet_meta\n", "string required"]
]) {
  it(`rejects invalid packet metadata: ${manifest}`, async () => {
    const actual = await run(manifest!);
    assert.notEqual(actual.result.exitCode, 0);
    assert.ok(actual.stderr.includes(error!), actual.stderr);
    assert.equal(actual.output.toString(), "keep");
  });
}
