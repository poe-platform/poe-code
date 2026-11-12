import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const packet of [
  Buffer.from("P1\n3 2\n0 1 0\n1 0 1\n"),
  Buffer.concat([Buffer.from("P4\n3 2\n"), Buffer.from([0x40, 0xa0])]),
  Buffer.from("P1\n# mask\n3 2\n0 1 # row\n0\n1 0 1\n"),
  Buffer.concat([Buffer.from("P4\n# mask\n3 2\n"), Buffer.from([0x5f, 0xbf])])
]) {
  for (const mode of ["file", "stdin", "pipe-auto", "pipe-explicit", "copy", "truncated"] as const) {
    it(`decodes ${packet.subarray(0, 2)} PBM ${mode} with white zeroes and byte-aligned rows`, async () => {
      const pipe = mode.startsWith("pipe") || mode === "copy";
      const input = mode === "truncated" ? packet.subarray(0, packet.length - 3) : pipe ? Buffer.concat([packet, packet]) : packet;
      const volume = Volume.fromJSON({ "/in.mask.pbm": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(pipe ? ["-f", "image2pipe"] : []),
          ...(mode === "pipe-explicit" ? ["-c:v", "pbm"] : []),
          "-i", mode === "stdin" || pipe ? "pipe:0" : "/in.mask.pbm",
          ...(mode === "copy" ? ["-c:v", "copy"] : []),
          "-pix_fmt", "gray", "-f", mode === "copy" ? "image2pipe" : "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (mode === "truncated") {
        assert.notEqual(result.exitCode, 0);
        assert.equal(Buffer.concat(stdout).length, 0);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const pixels = Buffer.from([255, 0, 255, 0, 255, 0]);
        assert.deepEqual(Buffer.concat(stdout), mode === "copy" ? input : pipe ? Buffer.concat([pixels, pixels]) : pixels);
      }
    });
  }
}
