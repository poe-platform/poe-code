import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/amr-encode.wav", import.meta.url));
// Native FFmpeg 7.0.2: -i amr-encode.wav -c:a libvo_amrwbenc -b:a 23.85k out.amr
const reference = readFileSync(new URL("./fixtures/amr-encode.amr", import.meta.url));
for (const extension of ["3gp", "amr"]) {
  it(`encodes mono PCM as AMR-WB in ${extension} through async and sync commands`, async () => {
    const target = `/out.${extension}`;
    const volume = Volume.fromJSON({ "/in.wav": input, [target]: "KEEP" });
    const args = ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "libvo_amrwbenc", "-b:a", "23.85k", target];
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
    const verify = () => {
      const output = volume.readFileSync(target) as Buffer;
      if (extension === "amr") assert.deepEqual(output, reference);
      else {
        const document = parseMp4(output, { decodeAudio: false });
        assert.equal(document.majorBrand, "3gp4");
        const track = document.tracks[0]!;
        assert.equal(track.editList?.[0]?.mediaTime, 80);
        assert.equal(track.codecDescriptions[0]!.codecName, "amr_wb");
        assert.equal(track.codecDescriptions[0]!.sampleRate, 16000);
        assert.equal(track.codecDescriptions[0]!.channels, 1);
        assert.equal(track.samples.length, 6);
        assert.ok(track.samples.every(sample => sample.duration / track.timescale === 0.02));
        assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), reference.subarray(9));
      }
    };
    verify();
    volume.writeFileSync(target, "KEEP");
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    verify();
  });
}

for (const extension of ["3gp", "amr"]) {
  for (const [name, extra, limits] of [
    ["unsupported bitrate", ["-b:a", "12k"], {}],
    ["stereo", ["-ac", "2"], {}],
    ["unsupported rate", ["-ar", "8000"], {}],
    ["output budget", [], { maxOutputBytes: 10 }]
  ] as const) {
    it(`preserves existing ${extension} output on ${name}`, async () => {
      const target = `/out.${extension}`;
      const volume = Volume.fromJSON({ "/in.wav": input, [target]: "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits }).execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "libvo_amrwbenc", ...extra, target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /AMR|maxOutputBytes/);
      assert.equal(volume.readFileSync(target, "utf8"), "KEEP");
    });
  }
}
