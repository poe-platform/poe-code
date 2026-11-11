import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { image2Ast } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg preserves this entire packet, changing only byte 13 for -color_trc.
const packet = Buffer.from("716f696600000001000000010300fe8040200000000000000001", "hex");
const cases = [
  ["inherited sRGB", 0, [], 0],
  ["inherited linear", 1, [], 1],
  ["explicit linear", 0, ["-color_trc", "linear"], 1],
  ["explicit sRGB", 1, ["-color_trc", "iec61966-2-1"], 0],
  ["numeric linear", 0, ["-color_trc:v:0", "8"], 1],
  ["unmatched stream", 1, ["-color_trc:v:1", "iec61966-2-1"], 1],
  ["other transfer", 1, ["-color_trc", "bt709"], 0],
  ["last transfer wins", 0, ["-color_trc", "linear", "-color_trc", "iec61966-2-1"], 0]
] as const;

for (const mode of ["async file", "async sequence", "async pipe", "input sequence", "sync file", "sync sequence"]) {
  for (const [name, inputFlag, options, outputFlag] of cases) {
    it(`uses ${name} for QOI ${mode} without changing samples`, async () => {
      const input = Buffer.from(packet);
      input[13] = inputFlag;
      const volume = Volume.fromJSON({ "/in.qoi": input, "/in1.qoi": input });
      const output = mode.endsWith("sequence") && mode !== "input sequence" ? "/out%d.qoi" : "/out.qoi";
      const args = ["-y", "-v", "error", "-i", mode === "input sequence" ? "/in%d.qoi" : "/in.qoi", ...options,
        ...(mode === "async pipe" ? ["-c:v", "qoi", "-f", "image2pipe", "pipe:1"] : [output])];
      const stdout: Buffer[] = [];
      if (mode.startsWith("sync")) {
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
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const expected = Buffer.from(packet);
      expected[13] = outputFlag;
      assert.deepEqual(mode === "async pipe" ? Buffer.concat(stdout) : volume.readFileSync(output.replace("%d", "1")), expected);
    });
  }
}

for (const inputFlag of [0, 1]) {
  it(`preserves the QOI packet during stream copy (flag=${inputFlag})`, async () => {
    const input = Buffer.from(packet);
    input[13] = inputFlag;
    const volume = Volume.fromJSON({ "/in.qoi": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.qoi", "-c:v", "copy", "-color_trc", "linear", "/out.qoi"],
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
    assert.deepEqual(volume.readFileSync("/out.qoi"), input);
  });
}

for (const flag of [0, 1]) {
  it(`reads QOI transfer metadata without inferring sRGB (flag=${flag})`, () => {
    const input = Buffer.from(packet);
    input[13] = flag;
    assert.equal(image2Ast().parse(input).tracks[0]?.codecDescriptions[0]?.colorMetadata?.transfer,
      flag === 1 ? 8 : undefined);
  });
}
