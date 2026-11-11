import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, mixed = false) {
  const volume = Volume.fromJSON({
    "/a.gray": Buffer.from([10, 11, 20, 21, 30, 31]),
    "/b.gray": Buffer.from([100, 101, 110, 111]),
    "/out.raw": "keep"
  });
  if (mixed) {
    const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 2, frameCount: 2, includeAudio: true }));
    const tracks = [...doc.tracks].sort((a, b) => Number(a.type === "video") - Number(b.type === "video"));
    volume.writeFileSync("/mixed.mp4", serializeMp4({ ...doc, tracks }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y",
      ...(mixed ? ["-i", "/mixed.mp4", "-i", "/mixed.mp4"] : [
        "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/a.gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/b.gray"]),
      "-filter_complex", `${graph}[out]`, "-map", "[out]", "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, output: volume.readFileSync("/out.raw") as Buffer, stderr };
}

for (const filter of ["hstack", "vstack", "xstack"]) {
  for (const suffix of ["", ":0", ":v", ":v:0"]) {
    for (const branch of [false, true]) {
      it(`${filter} resolves ${suffix || "file-only"} labels ${branch ? "through a branch" : "directly"}`, async () => {
        const result = await run(branch
          ? `[1${suffix}]hflip[b];[0${suffix}][b]${filter}`
          : `[0${suffix}][1${suffix}]${filter}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.output.toString("hex"), branch ? "0a0b656414156f6e1e1f6f6e" : "0a0b646514156e6f1e1f6e6f");
      });
    }
  }

  for (const label of ["2", "0:1", "0:v:1", "0:a", "0:", "0:v:", "0:0:0", "0:v:0:0", "-1", "0:-1", "0:0.0"]) {
    it(`${filter} rejects unavailable or malformed input [${label}] without replacing output`, async () => {
      const result = await run(`[${label}][1:v]${filter}`);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes(filter), result.stderr);
      assert.equal(result.output.toString(), "keep");
    });
  }

  for (const suffix of ["", ":1", ":v:0", ":0", ":v:1"]) {
    it(`${filter} distinguishes absolute and video ordinals in audio-first files (${suffix || "file-only"})`, async () => {
      const result = await run(`[0${suffix}][1${suffix}]${filter}`, true);
      if ([":0", ":v:1"].includes(suffix)) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.output.toString(), "keep");
      } else {
        assert.equal(result.exitCode, 0, result.stderr);
        const control = await run(`[0:v][1:v]${filter}`, true);
        assert.equal(control.exitCode, 0, control.stderr);
        assert.equal(result.output.length, 16 * 16 * 2 * 2);
        assert.deepEqual(result.output, control.output);
      }
    });
  }
}
