import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function inputs() {
  const volume = Volume.fromJSON({});
  const header = "524946462c00000057415645666d74201000000001000200401f0000007d0000040010006461746108000000";
  volume.writeFileSync("/a.wav", Buffer.from(header + "640038ff2c0170fe", "hex"));
  volume.writeFileSync("/b.wav", Buffer.from(header + "4c0450fb140588fa", "hex"));
  return volume;
}

// Native FFmpeg 7.0.2 status and complete stdout for two 8 kHz stereo WAVs.
for (const [format, maps, exitCode, hex] of [
  ["s16le", ["0:a", "1:a"], 234, ""],
  ["s16le", ["1:a", "0:a"], 234, ""],
  ["s16le", ["1:a", "1:a"], 234, ""],
  ["s16le", ["0:a", "1:a", "-0:a"], 0, "4c0450fb140588fa"],
  ["s16le", ["1:a"], 0, "4c0450fb140588fa"],
  ["u8", ["0:a", "1:a"], 234, ""],
  ["f32le", ["0:a", "1:a"], 234, ""],
  ["wav", ["0:a", "1:a"], 234, ""]
] as const) {
  it(`validates mapped ${format} output: ${maps.join(", ")}`, async () => {
    const volume = inputs();
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav",
        ...maps.flatMap(map => ["-map", map]), "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
  });
}
