import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const loop of [0, 1, 2]) {
    for (const seek of [0, 200]) {
      it(`${sync ? "sync" : "async"} finite input loop ${loop} restarts at sample zero after seeking ${seek} samples`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 700 }, (_, i) => i / 32768)] }));
        const args = ["-v", "error", "-y", "-stream_loop", String(loop),
          ...(seek ? ["-ss", "0.025"] : []), "-i", "/in.wav", "-f", "s16le", "/out.raw"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        const count = 700 * (loop + 1) - seek;
        assert.equal(bytes.length, count * 2);
        assert.deepEqual(Array.from({ length: count }, (_, i) => bytes.readInt16LE(i * 2)),
          Array.from({ length: count }, (_, i) => (i + seek) % 700));
      });
    }
  }
}

for (const sync of [false, true]) {
  for (const [loop, seek, expected] of [
    [1, ["-ss", "0.004"], [500, 600, 300, 400, 500, 600]],
    [1, ["-sseof", "-0.002"], [500, 600, 300, 400, 500, 600]],
    [2, ["-ss", "0.004"], [500, 600, 300, 400, 500, 600, 100, 200, 300, 400, 500, 600]],
    [1, ["-ss", "0.002"], [300, 400, 500, 600, 100, 200, 300, 400, 500, 600]],
    [0, ["-ss", "0.004"], [500, 600]],
    [1, [], [100, 200, 300, 400, 500, 600, 100, 200, 300, 400, 500, 600]]
  ] as const) {
    it(`${sync ? "sync" : "async"} finite WAV loop ${loop} trims seek pre-roll for ${seek.join(" ")}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from([100, 200, 300, 400, 500, 600], value => value / 32768)] }));
      const chunks: Buffer[] = [];
      const args = ["-v", "error", "-y", "-stream_loop", String(loop),
        ...seek, "-i", "/in.wav", "-f", "s16le", sync ? "/out.raw" : "pipe:1"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
          stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const bytes = sync ? volume.readFileSync("/out.raw") as Buffer : Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), expected);
    });
  }
}

for (const scenario of [
  { name: "first frame", loop: 1, seek: true, output: ["-frames:a", "1"], expected: [300, 400, 500, 600] },
  { name: "second frame", loop: 1, seek: true, output: ["-af", "aselect='eq(n,1)'"], expected: [100, 200, 300, 400, 500, 600] },
  { name: "output seek", loop: 1, seek: true, output: ["-ss", "0.004"], expected: [300, 400, 500, 600] },
  { name: "all samples", loop: 1, seek: true, output: [], expected: [300, 400, 500, 600, 100, 200, 300, 400, 500, 600] },
  { name: "no seek", loop: 1, seek: false, output: ["-frames:a", "1"], expected: [100, 200, 300, 400, 500, 600] },
  { name: "no loop", loop: 0, seek: true, output: ["-frames:a", "1"], expected: [300, 400, 500, 600] },
  { name: "third frame timestamp", loop: 2, seek: true, output: ["-af", "aselect='eq(t,0.006)'"], expected: [100, 200, 300, 400, 500, 600] }
]) {
  it(`preserves sought WAV loop boundaries: ${scenario.name}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from([100, 200, 300, 400, 500, 600], value => value / 32768)] }));
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-stream_loop", String(scenario.loop),
        ...(scenario.seek ? ["-ss", "0.002"] : []), "-i", "/in.wav", ...scenario.output, "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(chunks);
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), scenario.expected);
  });
}
