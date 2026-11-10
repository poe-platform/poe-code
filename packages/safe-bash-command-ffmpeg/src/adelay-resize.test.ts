import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM references for 32 stereo samples at 8 kHz:
// 7.0.2 for the failure and controls, 9.0.1 for subsequent resize commands.
for (const [commands, count, hash] of [
  ["0.001 adelay@d delays 12S|0S;0.002 adelay@d delays 1S|0S", 44,
    "1f8e58238532ca56778e219226df71bc8b5bf5e0477e9b3d6cacfd0972f6e188"],
  ["0.001 adelay@d delays 12S|0S;0.002 adelay@d delays 1S|0S;0.003 adelay@d delays 4S|0S", 44,
    "a31af126446be8bf44c4457fa8799e0d8e4dfd13ccf1fe4b73432d033edd1f34"],
  ["0.001 adelay@d delays 12S|0S;0.002 adelay@d delays 1S|0S;0.003 adelay@d delays 16S|0S", 48,
    "584d949991f8ae43ca6f43dfe154ce98a86bfee469d09678fb2ab173ed47f450"],
  ["0.001 adelay@d delays 12S|0S;0.002 adelay@d delays 1S|0S;0.003 adelay@d delays 0S|0S", 44,
    "a464be7dcfb9b683d4aacf867082353d32053615b7cc4368562674c0f675b116"],
  ["0.001 adelay@d delays 12S|0S", 44,
    "c70e4ff3556b46b3b9b07b742ce5a8cd6a795df6aea513bfce899f351733e3f0"],
  ["0.002 adelay@d delays 1S|0S", 33,
    "1f51c7703b26dc0991316d40cf7fe5bd9ee7b324ca93ae9cff1dd3aece8a82b1"]
] as const) {
  for (const graph of [false, true]) {
    it(`renders runtime delay resizing: ${commands} (graph ${graph})`, async () => {
      const input = Buffer.alloc(32 * 4);
      for (let i = 0; i < 32; i++) {
        input.writeInt16LE(100 + i, i * 4);
        input.writeInt16LE(-200 - i, i * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const filter = `asetnsamples=8:0,asendcmd=c='${commands}',adelay@d=0S`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(stdout);
      assert.equal(output.length, count * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
