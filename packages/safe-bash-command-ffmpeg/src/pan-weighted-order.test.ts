import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 accepts reordered speakers for mixing, but rejects pure routing.
for (const [expression, exitCode, output] of [
  ["FR+FL|c0=c1|c1=c0", 234, ""],
  ["BC+LFE|c0=c1|c1=c0", 234, ""],
  ["FR+FL|c0=0.5*c1|c1=c0", 0, "a00fe803d00730f848f410270cfed8dc"],
  ["BC+LFE|c0=0.5*c1|c1=c0", 0, "a00fe803d00730f848f410270cfed8dc"],
  ["FR+FL|FR=0.5*c1|FL=c0", 0, "a00fe803d00730f848f410270cfed8dc"],
  ["stereo|c0=c1|c1=c0", 0, "401fe803a00f30f890e8102718fcd8dc"],
  ["stereo|c0=0.5*c1|c1=c0", 0, "a00fe803d00730f848f410270cfed8dc"]
] as const) {
  for (const complex of [false, true]) {
    for (const target of ["pipe:1", "/out.raw"]) {
      it(`matches pan weighted output order (${expression}, graph=${complex}, target=${target})`, async () => {
        const input = Buffer.from("e803401f30f8a00f102790e8d8dc18fc", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const filters = complex
          ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
          : ["-af", `pan=${expression}`];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            ...filters, "-f", "s16le", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        const actual = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target);
        assert.deepEqual(actual, Buffer.from(output, "hex"));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        if (exitCode !== 0) assert.ok(stderr.includes("pan: unsupported output channel order"), stderr);
        else assert.equal(stderr, "");
      });
    }
  }
}
