import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [selector, rotated] of [["", true], ["v:0", true], ["v:1", false], ["0", true], ["1", false], ["a:0", false]] as const) {
    for (const flag of ["hflip", "vflip"] as const) {
      it(`matches display flip ${flag} against input streams (${selector}, sync=${sync})`, async () => {
        const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 2 });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const args = ["-y", `-display_${flag}${selector ? `:${selector}` : ""}`, "-i", "/in.mp4", "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
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
        }
        const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
        assert.deepEqual(output.tracks[0]!.matrix, rotated
          ? [flag === "hflip" ? -65536 : 65536, 0, 0, 0, flag === "vflip" ? -65536 : 65536, 0, 0, 0, 1073741824]
          : parseMp4(Buffer.from(input)).tracks[0]!.matrix);
        assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), parseMp4(Buffer.from(input)).tracks[0]!.samples.map(sample => sample.data));
      });
    }
  }
}

for (const sync of [false, true]) {
  for (const options of [
    ["-display_hflip", "-display_rotation", "90"],
    ["-display_rotation", "90", "-display_hflip"],
    ["-display_hflip", "-display_vflip"],
    ["-display_hflip", "-display_hflip"]
  ]) {
    it(`combines input display overrides (${options.join(" ")}, sync=${sync})`, async () => {
      const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2 }));
      const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, rotation: 45 })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const args = ["-y", ...options, "-i", "/in.mp4", "-c", "copy", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
        } as never);
        assert.equal(result.exitCode, 0);
      }
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
      assert.deepEqual(output.tracks[0]!.matrix, options.includes("90")
        ? [0, -65536, 0, -65536, 0, 0, 0, 0, 1073741824]
        : [-65536, 0, 0, 0, options.includes("-display_vflip") ? -65536 : 65536, 0, 0, 0, 1073741824]);
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), parseMp4(Buffer.from(input)).tracks[0]!.samples.map(sample => sample.data));
    });
  }
}

for (const separateInputs of [false, true]) {
  it(`keeps a flip on the selected input when outputs are reordered (separateInputs=${separateInputs})`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2 }));
    const input = serializeMp4({ ...base, tracks: [base.tracks[0]!, { ...base.tracks[0]!, id: 2 }] });
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
    const args = ["-y", "-display_hflip:v:0", "-i", "/in.mp4",
      ...(separateInputs ? ["-i", "/in.mp4", "-map", "1:v:0"] : ["-map", "0:v:1"]),
      "-map", "0:v:0", "-c", "copy", "/out.mp4"];
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

    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
    assert.equal(output.tracks.length, 2);
    assert.deepEqual(output.tracks[0]!.matrix, base.tracks[0]!.matrix);
    assert.deepEqual(output.tracks[1]!.matrix, [-65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824]);
  });
}
