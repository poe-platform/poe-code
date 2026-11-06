import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const safe of [undefined, "1", "0"]) {
  for (const target of ["a.wav", "dir/A-z_09.wav", "with space.wav", "/a.wav", "../a.wav", ".hidden.wav", "dir/.hidden.wav", "file:a.wav", "é.wav"]) {
    for (const format of [[], ["-f", "concat"]]) {
      it(`concat safe=${safe} validates ${target} with format ${format}`, async () => {
        const allowed = safe === "0" || ["a.wav", "dir/A-z_09.wav"].includes(target);
        const volume = Volume.fromJSON({ "/list.ffconcat": `ffconcat version 1.0\nfile '${target}'\nfile b.wav\n` });
        volume.mkdirSync("/dir");
        for (const [name, base] of [[target, 1000], ["b.wav", -9000]] as const) {
          const path = name.startsWith("file:") ? name.slice(5) : name;
          volume.writeFileSync(path.startsWith("/") ? path : `/${path}`, encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
        }
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", ...format, ...(safe === undefined ? [] : ["-safe", safe]), "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (allowed) {
          assert.equal(result.exitCode, 0, stderr);
          const samples = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
          assert.equal(samples.length, 16000);
          assert.deepEqual(Array.from(samples, sample => sample * 32768), [
            ...Array.from({ length: 8000 }, (_, i) => 1000 + i),
            ...Array.from({ length: 8000 }, (_, i) => -9000 + i)
          ]);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes(`Unsafe file name '${target}'`), stderr);
          assert.equal(volume.existsSync("/out.wav"), false);
        }
      });
    }
  }
}

for (const safe of [undefined, "1"]) {
  it(`concat safe=${safe} rejects option directives`, async () => {
    const volume = Volume.fromJSON({ "/list.ffconcat": "file a.wav\noption protocol_whitelist file\n", "/out.wav": "keep" });
    volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-f", "concat", ...(safe === undefined ? [] : ["-safe", safe]), "-i", "/list.ffconcat", "/out.wav"],
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
    assert.ok(stderr.includes("option not allowed if safe"), stderr);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

it("concat resets safe mode for each input", async () => {
  const volume = Volume.fromJSON({
    "/list.ffconcat": "file 'with space.wav'\n", "/out.wav": "keep"
  });
  volume.writeFileSync("/with space.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-f", "concat", "-i", "/list.ffconcat", "/out.wav"],
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
  assert.ok(stderr.includes("Unsafe file name 'with space.wav'"), stderr);
  assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
});
