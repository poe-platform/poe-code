import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(filter: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 32 }, () => 1000 / 32768),
    Float64Array.from({ length: 32 }, () => 1000 / 32768)
  ] }, { bitsPerSample: 16 }));
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
    "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}

const first = "0.001 volume@v volume 2;";
const last = "0.003 volume@v volume 0;";
for (const graph of [false, true]) {
  for (const [name, schedule] of [
    ["control", `${first} ${last}`],
    ["between commands", `${first} # comment\n${last}`],
    ["leading comment", `# comment\n${first} ${last}`],
    ["multiple comments and CRLF", `  # first; ignored\r\n\t# second\r\n${first}\r\n# middle; ignored\r\n${last}`],
    ["trailing comment without newline", `${first} ${last} # trailing; ignored`]
  ]) {
    it(`asendcmd skips ${name} (graph=${graph})`, async () => {
      const output = await render(`asetnsamples=n=8:p=0,asendcmd=c='${schedule}',volume@v=1`, graph);
      assert.equal(output.length, 32 * 4);
      for (let i = 0; i < 32; i++) {
        const expected = i < 8 ? 1000 : i < 24 ? 2000 : 0;
        assert.equal(output.readInt16LE(i * 4), expected, `left sample ${i}`);
        assert.equal(output.readInt16LE(i * 4 + 2), expected, `right sample ${i}`);
      }
    });
  }
}
