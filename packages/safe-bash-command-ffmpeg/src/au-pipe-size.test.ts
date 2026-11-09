import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const size of [8, 0xffffffff]) {
  for (const target of ["pipe:1", "-", "/out.au"]) {
    it(`AU input size ${size} preserves audio and writes the correct size to ${target}`, async () => {
      const payload = Buffer.from([0, 100, 255, 56, 1, 44, 254, 112]);
      const input = Buffer.alloc(24 + payload.length);
      [0x2e736e64, 24, size, 3, 8000, 1].forEach((value, i) => input.writeUInt32BE(value, i * 4));
      input.set(payload, 24);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.au", input);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.au", "-c:a", "copy", "-f", "au", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(name: string) { return volume.readFileSync(name); },
          async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
          async stat(name: string) { return volume.statSync(name); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = target === "/out.au" ? volume.readFileSync(target) as Buffer : Buffer.concat(stdout);
      assert.equal(output.length, 40);
      assert.equal(output.readUInt32BE(4), 32);
      assert.deepEqual(output.subarray(32), payload);
      assert.equal(output.readUInt32BE(8), target === "/out.au" ? 8 : 0xffffffff);
    });
  }
}
