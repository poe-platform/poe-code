import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, input, dialogue] of [
  [
  "leading and trailing spaces",
  "1\n00:00:01,000 --> 00:00:02,000\n  alpha  \n\t indented \t\n",
  [
    "  alpha  \n\t indented \t"
  ]
  ],
  [
  "whitespace dialogue before next cue",
  "1\n00:00:01,000 --> 00:00:02,000\nalpha\n \t \n2\n00:00:01,500 --> 00:00:03,000\nbeta\n",
  [
    "alpha\n \t ",
    "beta"
  ]
  ],
  [
  "multiline control",
  "1\n00:00:01,000 --> 00:00:02,000\nfirst\nsecond\n",
  [
    "first\nsecond"
  ]
  ]
] as const) {
  it(`SRT stream copy preserves whitespace: ${name}`, async () => {
    const target = "/out.srt";
    const volume = Volume.fromJSON({ "/in.srt": input, [target]: "keep" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.srt", "-c:s", "copy", target],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const expected = dialogue.map((text, index) => `${index + 1}\n${index === 0 ? "00:00:01,000 --> 00:00:02,000" : "00:00:01,500 --> 00:00:03,000"}\n${text}\n\n`).join("");
    assert.equal(volume.readFileSync(target, "utf8"), expected);
  });
}
