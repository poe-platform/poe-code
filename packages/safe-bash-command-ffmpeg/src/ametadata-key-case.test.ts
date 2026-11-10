import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const mode of ["add", "print"]) {
  for (const key of ["label", "LABEL"]) {
    it(`matches ametadata ${mode} key ${key} without changing samples or timing`, async () => {
      const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const filter = "asetnsamples=n=3:p=0,ametadata=mode=add:key=label:value=sample,"
        + (mode === "add"
          ? `ametadata=mode=add:key=${key}:value=new,ametadata=mode=print:file=tags`
          : `ametadata=mode=print:key=${key}:file=tags`);
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1",
          "-i", "in.raw", "-af", filter, "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), input);
      const printedKey = mode === "print" ? key : "label";
      assert.equal(volume.readFileSync("/tags", "utf8"), [
        `frame:0    pts:0       pts_time:0\n${printedKey}=sample\n`,
        `frame:1    pts:3       pts_time:0.000375\n${printedKey}=sample\n`,
        `frame:2    pts:6       pts_time:0.00075\n${printedKey}=sample\n`,
        `frame:3    pts:9       pts_time:0.001125\n${printedKey}=sample\n`
      ].join(""));
    });
  }
}
