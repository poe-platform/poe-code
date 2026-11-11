import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exit statuses and PCM for the same raw inputs and argv.
for (const [option, exitCode, hex] of [
  ["dropout_transition=-1", 222, ""],
  ["duration=3", 222, ""],
  ["inputs=0", 222, ""],
  ["duration=nope", 234, ""],
  ["normalize=maybe", 234, ""],
  ["unknown=1", 8, ""],
  ["duration=shortest", 0, "9600a7fd1c04d709"]
] as const) {
  it(`matches native amix status and stdout for ${option}`, async () => {
    const volume = Volume.fromJSON({
      "/i0.s16le": Buffer.from("e9032df8bd0ba70feb137917b3e2", "hex"),
      "/i1.s16le": Buffer.from("43fd21037bfc0704", "hex")
    });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/i0.s16le",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/i1.s16le",
        "-filter_complex", `[0:a][1:a]amix=${option}[o]`, "-map", "[o]", "-f", "s16le", "pipe:1"],
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
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    assert.equal(result.exitCode, exitCode, stderr);
  });
}
