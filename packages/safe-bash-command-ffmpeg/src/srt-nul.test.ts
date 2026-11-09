import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const first = "1\n00:00:01,000 --> 00:00:02,000\n";
const second = "\n2\n00:00:01,500 --> 00:00:03,000\n";
const cases = [
  ["NUL inside first dialogue", first + "hi\0hidden\n" + second + "beta\n", []],
  ["NUL inside second dialogue", first + "alpha\n" + second + "be\0ta\n", ["alpha"]],
  ["NUL on following line", first + "alpha\n\0\n", ["alpha"]],
  ["complete input", first + "alpha\n" + second + "beta\n", ["alpha", "beta"]]
] as const;

for (const [name, input, expected] of cases) {
  it(`SubRip stream copy: ${name}`, async () => {
    const volume = Volume.fromJSON({ "/in.srt": input, "/out.srt": "keep" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.srt", "-c:s", "copy", "/out.srt"],
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
    const output = volume.readFileSync("/out.srt").toString();
    assert.equal(output.includes("\0"), false);
    const expectedText = expected.length === 0 ? "" : first + expected[0] + "\n"
      + (expected.length === 2 ? second + expected[1] + "\n" : "");
    assert.equal(output.replaceAll("\r\n", "\n").trimEnd(), expectedText.trimEnd());
  });
}
