import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 checks front-speaker symmetry for pure routing, before normalization.
for (const [expression, exitCode, output] of [
  ["FL+FC|c0=c1|c1=c0", 234, ""],
  ["FL+FC|c0=c1", 234, ""],
  ["FR+FC|c0=c1", 234, ""],
  ["FL+LFE|c0=c1", 234, ""],
  ["2 channels (FL+FC)|c0=c1", 234, ""],
  ["0x5|c0=c1", 234, ""],
  ["FL+FC|c0<1*c1", 234, ""],
  ["FL+FC|c0=0.5*c1|c1=0.5*c0", 0, "06fff4018501a700"],
  ["FL+FC|c0<2*c1", 0, "0cfe000009030000"],
  ["FL+FC|c0=c1+0.5*c7", 0, "0cfe000009030000"],
  ["stereo|c0=c1|c1=c0", 0, "0cfee80309034d01"],
  ["FL|c0=c1", 0, "0cfe0903"]
] as const) {
  for (const complex of [false, true]) {
    for (const target of ["pipe:1", "/out.raw"]) {
      it(`matches pan routing layout (${expression}, graph=${complex}, target=${target})`, async () => {
        const input = Buffer.from("e8030cfe4d010903", "hex");
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
        if (exitCode !== 0) assert.ok(stderr.includes("pan: unsupported output channel layout"), stderr);
      });
    }
  }
}
