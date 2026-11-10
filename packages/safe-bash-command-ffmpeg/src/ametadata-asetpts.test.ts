import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const tagFirst of [true, false]) {
    it(`prints current frame timestamps with metadata added ${tagFirst ? "before" : "after"} asetpts (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const add = "ametadata=mode=add:key=label:value=sample";
      const shift = "asetpts=PTS+8";
      const filter = `asetnsamples=n=3:p=0,${tagFirst ? `${add},${shift}` : `${shift},${add}`},ametadata=mode=print:file=tags`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "-"],
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
      assert.equal(volume.readFileSync("/tags", "utf8"),
        "frame:0    pts:8       pts_time:0.001\nlabel=sample\n" +
        "frame:1    pts:11      pts_time:0.001375\nlabel=sample\n" +
        "frame:2    pts:14      pts_time:0.00175\nlabel=sample\n" +
        "frame:3    pts:17      pts_time:0.002125\nlabel=sample\n");
    });
  }
}
