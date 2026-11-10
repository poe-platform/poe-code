import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, existingOutput = false) {
  const volume = Volume.fromJSON(existingOutput ? { "/out.pcm": "sentinel" } : {});
  for (const [name, value] of [["a", 12000], ["b", -4000]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(1024).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]acrossfade=${options}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}

for (const prefix of ["d=", "duration=", "4:"]) {
  for (const value of ["0.016", "16ms", "16000us", "0.016s"]) {
    it(`acrossfade ${prefix}${value} matches decimal seconds byte for byte`, async () => {
      const control = await run("d=0.016");
      assert.equal(control.result.exitCode, 0, control.stderr);
      const { result, volume, stderr } = await run(`${prefix}${value}`);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.pcm");
      assert.equal(output.length, (2048 - 128) * 2);
      assert.deepEqual(output, control.volume.readFileSync("/out.pcm"));
    });
  }
  for (const value of ["0.12e-1", "1.6e-2", "16e-3s", "16badms", "0.016junk", "-16ms", "NaN", "Infinity", prefix === "4:" ? ":" : ""]) {
    for (const existingOutput of [false, true]) {
      it(`acrossfade rejects ${prefix}${value} without ${existingOutput ? "replacing" : "creating"} output`, async () => {
        const { result, volume, stderr } = await run(`${prefix}${value}`, existingOutput);
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("acrossfade: invalid duration"), stderr);
        assert.equal(volume.existsSync("/out.pcm"), existingOutput);
        if (existingOutput) assert.equal(volume.readFileSync("/out.pcm", "utf8"), "sentinel");
      });
    }
  }
}
