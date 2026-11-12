import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  it(`preserves asetpts registers per filter and invocation (${complex ? "complex" : "simple"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 17 }, (_, i) => (i + 1) / 32768)] }));
    const command = createFfmpegCommand();
    async function run(filter: string) {
      let stdout = "", stderr = "";
      const chain = `asetnsamples=4:p=0,${filter}`;
      const result = await command.execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[s]`, "-map", "[s]"] : ["-af", chain]),
          "-f", "framecrc", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      return stdout.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
    }

    const control = await run("asetpts=N*20");
    assert.deepEqual(control.map(row => Number(row[2])), [0, 80, 160, 240, 320]);
    assert.deepEqual(control.map(row => row.slice(3, 5)), [
      ["4", "8"], ["4", "8"], ["4", "8"], ["4", "8"], ["1", "2"]
    ]);
    for (const filter of [
      "asetpts=st(0\\,ld(0)+2)",
      "asetpts=st(0\\,ld(0)+2)",
      "asetpts=st(0\\,ld(0)+100),asetpts=st(0\\,ld(0)+2)",
      "asetpts=st(0\\,ld(0)+100),asetpts=st(9\\,ld(9)+2)+ld(0)"
    ]) {
      const rows = await run(filter);
      // Native FFmpeg: persistent registers yield 2, 4, 6, 8, 10 without changing PCM.
      assert.deepEqual(rows, control.map((row, i) =>
        [row[0], String((i + 1) * 2), String((i + 1) * 2), ...row.slice(3)]), filter);
    }
  });
}
