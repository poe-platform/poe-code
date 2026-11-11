import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes for 64 stereo frames at 1 kHz.
for (const [filter, hash] of [
  ["acrusher=bits=2", "dd47b79ef7e8e1ce12a177fec52b5c8f75b99651296c60f4ca6e025837ece2ec"],
  ["acrusher=bits='randomi(0,2,2)'", "dd47b79ef7e8e1ce12a177fec52b5c8f75b99651296c60f4ca6e025837ece2ec"],
  ["asendcmd=c='0 acrusher bits randomi(0,2,2)',acrusher", "dd47b79ef7e8e1ce12a177fec52b5c8f75b99651296c60f4ca6e025837ece2ec"],
  ["asendcmd=c='0 acrusher bits 2+random(0)',acrusher", "0ad3adc9fb0207a5c3509e825ddb2f2ce904ec039e19deae07c267f501d5502a"],
  ["acrusher=bits='2+random(0)'", "0ad3adc9fb0207a5c3509e825ddb2f2ce904ec039e19deae07c267f501d5502a"]
] as const) {
  for (const graph of [false, true]) {
    it(`acrusher random bit depth matches native (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const input = Buffer.alloc(64 * 4);
      for (let i = 0; i < 64; i++) {
        input.writeInt16LE(i * 1667 % 60001 - 30000, i * 4);
        input.writeInt16LE(25000 - i * 2345 % 50001, i * 4 + 2);
      }
      const command = createFfmpegCommand();
      for (let run = 0; run < 2; run++) {
        const fs = Volume.fromJSON({ "/in.pcm": input });
        let stderr = "";
        const result = await command.execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = fs.readFileSync("/out.pcm") as Buffer;
        assert.equal(output.length, 256);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }
}
