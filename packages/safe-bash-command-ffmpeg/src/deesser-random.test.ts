import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references: eight six-sample frames at 48 kHz.
const input = Buffer.alloc(48 * 2);
for (let i = 0; i < 48; i++) input.writeInt16LE((i * 7919) % 50000 - 25000, i * 2);

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({
    sampleRate: 48000, channels: [Float64Array.from({ length: 48 }, (_, i) => input.readInt16LE(i * 2) / 32768)]
  })) });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav",
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
  return output;
}


for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["deesser=i=1", "e382972aab618c957cfeb90aaf69df0c4c9c134301f4b0dc9f4540f84a5a8d28"],
    ["deesser=i=1:enable=0", "75604f234585e206fc03faaf253aecec3035d1b0f0bacdefbf9914f32c485058"],
    ["deesser=i=1:enable=random(0)", "7c20eac36a3217cee571468c79a5663d1c01e8006106a6687d9080b95c491991"],
    [String.raw`deesser=i=1:enable=randomi(0\,0\,1)`, "7c20eac36a3217cee571468c79a5663d1c01e8006106a6687d9080b95c491991"],
    ["asendcmd=c=0.0005 deesser enable random(0),deesser=i=1", "42cb98a089769c8372d4e3f96cf03f6bb90e1accb3fa3fcbf52535e7a3ab617b"]
  ] as const) {
    it(`${filter} matches native PCM on fresh runs (graph=${graph})`, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const output = await run(`asetnsamples=n=6:p=0,${filter}`, graph);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }
  for (const [filter, expected] of [
    ["asendcmd=c='0.0005 deesser enable random(0)',deesser=i=1:enable=random(0)", "deesser=i=1:enable='eq(n,0)+eq(n,3)+eq(n,4)+eq(n,7)'"],
    ["asendcmd=c='0.0005 deesser enable invalid',deesser=i=1:enable=random(0)", "deesser=i=1:enable='eq(n,0)+eq(n,3)+eq(n,4)'"],
    ["deesser=i=1:enable=random(0),deesser=i=1:enable=random(0)", "deesser=i=1:enable='eq(n,0)+eq(n,3)+eq(n,4)',deesser=i=1:enable='eq(n,0)+eq(n,3)+eq(n,4)'"]
  ] as const) {
    it(`preserves independent random state: ${filter} (graph=${graph})`, async () => {
      assert.deepEqual(await run(`asetnsamples=n=6:p=0,${filter}`, graph),
        await run(`asetnsamples=n=6:p=0,${expected}`, graph));
    });
  }

}
