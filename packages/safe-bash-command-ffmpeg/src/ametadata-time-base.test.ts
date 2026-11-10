import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");

// Headers from native FFmpeg 7.0.2 for ten mono PCM16 samples at 8 kHz.
for (const denominator of [4000, 8000]) {
  for (const addBefore of [false, true]) {
    it(`ametadata prints current 1/${denominator} timestamps with tags added ${addBefore ? "before" : "after"} asettb`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const add = "ametadata=mode=add:key=label:value=sample";
      const timeBase = `asettb=1/${denominator}`;
      const filter = ["asetnsamples=n=3:p=0", ...(addBefore ? [add, timeBase] : [timeBase, add]),
        "ametadata=mode=print:file=tags"].join(",");
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-af", filter, "-f", "s16le", "-"],
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
      assert.deepEqual(Buffer.concat(stdout), input);
      const timings = denominator === 4000
        ? [[0, "0"], [2, "0.0005"], [3, "0.00075"], [5, "0.00125"]]
        : [[0, "0"], [3, "0.000375"], [6, "0.00075"], [9, "0.001125"]];
      assert.equal(volume.readFileSync("/tags", "utf8"), timings.map(([pts, time], n) =>
        `frame:${String(n).padEnd(5)}pts:${String(pts).padEnd(7)} pts_time:${time}\nlabel=sample\n`).join(""));
    });
  }
}
