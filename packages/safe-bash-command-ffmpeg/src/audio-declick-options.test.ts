import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 PCM16 references; named options restart its shorthand cursor.
for (const name of ["adeclick", "adeclip"]) {
  for (const [options, expected] of [
    ["w=25:o=80:20", "fbfff8ffba02f7ff"],
    ["window=25:overlap=80:20", "fbfff8ffba02f7ff"],
    ["w=20:o=80", "fbfff8ffba02f7ff"],
    ["w=25:o=80:a=20", "fcfffaff2f02f9ff"],
    ["20:80", "fbfff8ffba02f7ff"],
    ["w=20:80", "fbfff8ffba02f7ff"],
    ["25:o=80:20", "fbfff8ffba02f7ff"],
    ["w=25:o=75:w=20:80", "fbfff8ffba02f7ff"]
  ]) {
    for (const graph of [false, true]) {
      it(`${name}=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from([-600, -500, 30000, -300], value => value / 32768)] }));
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const filter = `${name}=${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); },
            async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(),
          stdout: { async write(b: Uint8Array) { output.push(b); } },
          stderr: { async write(b: Uint8Array) { errors.push(b); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal(Buffer.concat(output).toString("hex"), expected);
      });
    }
  }
}
