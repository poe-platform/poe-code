import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const separator of ["", "# marker\n", "\n", "  \n  # marker\n\n"]) {
  for (const [directives, start, end] of [
    [["inpoint 0.25"], 2000, 8000],
    [["inpoint\t0.25"], 2000, 8000],
    [["inpoint \t 0.25", "outpoint\t 0.75"], 2000, 6096],
    [["inpoint 00:00:00.25"], 2000, 8000],
    [["inpoint 250ms"], 2000, 8000],
    [["inpoint 250000us"], 2000, 8000],
    [["outpoint 0.25"], 0, 2048],
    [["outpoint\t0.25"], 0, 2048],
    [["outpoint 0.256"], 0, 2048],
    [["outpoint 0.75"], 0, 6144],
    [["duration 0.5"], 0, 8000],
    [["inpoint 0.5", "outpoint 0.5"], 4000, 4000],
    [["inpoint 0", "outpoint 0"], 0, 0],
    [["inpoint 0.25", "outpoint 0.75"], 2000, 6096]
  ] as const) {
    it(`concat preserves ${directives.join(", ")} across ${JSON.stringify(separator)}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\nfile 'with space.wav'\n${separator}${directives.join(`\n${separator}`)}\n${separator}file b.wav\n`
      });
      for (const [name, base] of [["with space.wav", 1000], ["b.wav", -9000]] as const) {
        volume.writeFileSync(`/${name}`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
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
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channelData[0]!.length, end - start + 8000);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), [
        ...Array.from({ length: end - start }, (_, i) => 1000 + start + i),
        ...Array.from({ length: 8000 }, (_, i) => -9000 + i)
      ]);
    });
  }
}

for (const directives of [
  ["inpoint 0.5", "outpoint 0.25"],
  ["outpoint 0.25", "inpoint 0.5", "duration 1"]
]) {
  it(`concat rejects reversed range: ${directives.join(", ")}`, async () => {
    const volume = Volume.fromJSON({
      "/list.ffconcat": `file a.wav\n${directives.join("\n")}\nfile b.wav\n`
    });
    for (const [name, base] of [["a.wav", 1000], ["b.wav", -9000]] as const) {
      volume.writeFileSync(`/${name}`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.ok(stderr.includes("outpoint") && stderr.includes("inpoint"), stderr);
    assert.equal(volume.existsSync("/out.wav"), false);
  });
}

for (const directive of ["duration", "inpoint", "outpoint"]) {
  for (const prefix of ["", "ffconcat version 1.0\n# comment\n\n"]) {
    for (const existingOutput of [false, true]) {
      it(`concat rejects ${directive} before a file at line ${prefix.split("\n").length} with existing output ${existingOutput}`, async () => {
        const volume = Volume.fromJSON({
          "/list.ffconcat": `${prefix}${directive} 0.25\nfile a.wav\n`
        });
        const wav = encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (1000 + i) / 32768)] });
        volume.writeFileSync("/a.wav", wav);
        if (existingOutput) volume.writeFileSync("/out.wav", wav);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes(`Line ${prefix.split("\n").length}: ${directive} without file`), stderr);
        if (existingOutput) assert.deepEqual(volume.readFileSync("/out.wav"), Buffer.from(wav));
        else assert.equal(volume.existsSync("/out.wav"), false);
      });
    }
  }
}

for (const [manifest, keyword, line] of [
  ["file a.wav\nduraton 0.25\nfile b.wav\n", "duraton", 2],
  ["fil a.wav\nfile b.wav\n", "fil", 1],
  ["file a.wav\n# comment\n\nunknown\n", "unknown", 4],
  ["ffconcattypo version 1.0\nfile a.wav\n", "ffconcattypo", 1]
] as const) {
  for (const existingOutput of [false, true]) {
    it(`concat rejects ${keyword} on line ${line} with existing output ${existingOutput}`, async () => {
      const volume = Volume.fromJSON({ "/list.ffconcat": manifest });
      const wav = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 8000 }, (_, i) => (1000 + i) / 32768)] });
      volume.writeFileSync("/a.wav", wav);
      volume.writeFileSync("/b.wav", wav);
      if (existingOutput) volume.writeFileSync("/out.wav", wav);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes(`Line ${line}: unknown keyword '${keyword}'`), stderr);
      if (existingOutput) assert.deepEqual(volume.readFileSync("/out.wav"), Buffer.from(wav));
      else assert.equal(volume.existsSync("/out.wav"), false);
    });
  }
}

for (const directive of ["inpoint", "outpoint", "duration"]) {
  for (const value of ["xyz", "abc", "nonsense", "0.25junk", "00:00:xyz", "1:2:3:4", "NaN", "Infinity", "1e3", "", "00:60:00", "0.25msjunk", "9".repeat(400)]) {
    for (const existingOutput of [false, true]) {
      it(`concat rejects ${directive} value ${JSON.stringify(value)} with existing output ${existingOutput}`, async () => {
        const volume = Volume.fromJSON({ "/list.ffconcat": `file a.wav\nfile b.wav\n${directive} ${value}\n` });
        const wav = encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (1000 + i) / 32768)] });
        volume.writeFileSync("/a.wav", wav);
        volume.writeFileSync("/b.wav", wav);
        if (existingOutput) volume.writeFileSync("/out.wav", wav);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes(`Line 3: invalid ${directive}`), stderr);
        if (existingOutput) assert.deepEqual(volume.readFileSync("/out.wav"), Buffer.from(wav));
        else assert.equal(volume.existsSync("/out.wav"), false);
      });
    }
  }
}
