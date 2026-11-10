import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, filters, tags] of [
  ["preserves the add/print control", [], "label=sample\n"],
  ["deletes the requested key", ["ametadata=mode=delete:key=label"], ""],
  ["deletes all tags", ["ametadata=mode=add:key=other:value=keep", "ametadata=mode=delete"], ""],
  ["preserves unrelated tags", ["ametadata=mode=add:key=other:value=keep", "ametadata=mode=delete:key=label"], "other=keep\n"],
  ["ignores a missing key", ["ametadata=mode=delete:key=missing"], "label=sample\n"],
  ["deletes a matching value", ["ametadata=mode=delete:key=label:value=sample"], ""],
  ["preserves a different value", ["ametadata=mode=delete:key=label:value=other"], "label=sample\n"],
  ["adds tags again after deletion", ["ametadata=mode=delete", "ametadata=mode=add:key=label:value=new"], "label=new\n"]
] as const) {
  it(`ametadata ${name} without changing PCM or frame timing`, async () => {
    const pcm = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
    const volume = Volume.fromJSON({ "/in.raw": pcm, "/tags": "KEEP" });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: [
        "-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "in.raw",
        "-af", ["asetnsamples=n=3:p=0", "ametadata=mode=add:key=label:value=sample", ...filters, "ametadata=mode=print:file=tags"].join(","),
        "-f", "s16le", "-"
      ],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(stdout), pcm);
    const headers = [
      "frame:0    pts:0       pts_time:0\n",
      "frame:1    pts:3       pts_time:0.000375\n",
      "frame:2    pts:6       pts_time:0.00075\n",
      "frame:3    pts:9       pts_time:0.001125\n"
    ];
    assert.equal(volume.readFileSync("/tags", "utf8"), tags ? headers.map(header => header + tags).join("") : "");
  });
}
