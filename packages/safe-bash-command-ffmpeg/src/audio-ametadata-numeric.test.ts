import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.from("2823000000000000282300000000000000002823000000000000000000000000", "hex");

// Native FFmpeg comparisons use float precision and include approximate equality
// in greater/less. Numeric prefixes are accepted; nonnumeric values never match.
for (const mode of ["select", "print"]) {
  for (const [tag, value, comparison, matches] of [
    ["3", "1", "greater", true],
    ["3", "8", "greater", false],
    ["3", "8", "less", true],
    ["3", "1", "less", false],
    ["3", "3.0", "equal", true],
    ["3", "8", "equal", false],
    ["3", "3", "greater", true],
    ["3", "3", "less", true],
    ["0", "0.00000001", "equal", true],
    ["1", "1.0000001", "equal", false],
    ["30000000", "30000001", "equal", true],
    ["3", "3x", "equal", true],
    ["invalid", "0", "equal", false],
    ["3", "invalid", "less", false],
    ["3", "3", "same_str", true],
    ["3", "3.0", "same_str", false]
  ] as const) {
    it(`ametadata ${mode}: ${tag} ${comparison} ${value}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": pcm });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          "-af", `asetnsamples=n=4:p=0,ametadata=mode=add:key=k:value=${tag},ametadata=mode=${mode}:key=k:value=${value}:function=${comparison}`,
          "-f", "s16le", "pipe:1"],
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
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), mode === "print" || matches ? pcm : Buffer.alloc(0));
      assert.equal(stderr.split(`k=${tag}\n`).length - 1, mode === "print" && matches ? 4 : 0);
    });
  }
}
