import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 67 samples at 8 kHz; channel 0 repeats [0, 4000, 0, -4000].
// Stereo channel 1 uses (i * 1237) % 30001 - 15000.
for (const [expressions, sha256, channels = 1] of [
  ["real=real(b\\,ch):imag=imag(b\\,ch)", "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d"],
  ["real=real(4\\,ch):imag=imag(4\\,ch)", "1774085b6cc58ee4bfb9e6d6ec48cb0dad51c5f02fbe56e6cdb6d09e0d6967a1"],
  ["real=real(4.9\\,ch+0.9):imag=imag(4.9\\,ch+0.9)", "1774085b6cc58ee4bfb9e6d6ec48cb0dad51c5f02fbe56e6cdb6d09e0d6967a1"],
  ["real=real(-1\\,-1):imag=imag(100\\,100)", "e7e7ba7c94c2574ab9e0d47a90f4660dd0b83d4a935141568c8bfc1024ec87cb"],
  ["real=real(b\\,1)|re:imag=imag(b\\,1)|im", "13a20face6ad3e8bf92f7f4917daf67720165794924631faa88c7fed8541787c", 2],
  ["real=re:imag=im", "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d"],
  ["real=0:imag=0", "e7e7ba7c94c2574ab9e0d47a90f4660dd0b83d4a935141568c8bfc1024ec87cb"]
] as const) for (const graph of [false, true]) {
  it(`matches native afftfilt ${expressions}, graph=${graph}`, async () => {
    const input = Buffer.alloc(67 * channels * 2);
    for (let i = 0; i < 67; i++) {
      input.writeInt16LE([0, 4000, 0, -4000][i % 4]!, i * channels * 2);
      if (channels === 2) input.writeInt16LE((i * 1237) % 30001 - 15000, i * channels * 2 + 2);
    }
    const fs = Volume.fromJSON({ "/in.raw": input });
    const filter = `afftfilt=win_size=16:overlap=0.5:${expressions}`;
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const output = Buffer.concat(chunks);
    assert.equal(output.length, input.length);
    assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
  });
}
