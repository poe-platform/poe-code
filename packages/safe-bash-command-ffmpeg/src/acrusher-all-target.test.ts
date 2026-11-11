import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(64 * 4);
for (let frame = 0; frame < 64; frame++) {
  input.writeInt16LE(frame * 1667 % 60001 - 30000, frame * 4);
  input.writeInt16LE(25000 - frame * 2345 % 50001, frame * 4 + 2);
}

async function run(filter: string, complex: boolean) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.pcm", input);
  const chunks: Buffer[] = [];
  let stderr = "";
  const chain = `asetnsamples=n=4:p=0,${filter}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm",
      ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
      "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(chunk) { chunks.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = Buffer.concat(chunks);
  assert.equal(output.length, input.length);
  return output;
}

for (const complex of [false, true]) {
  it(`matches native all-target bit-depth changes through ${complex ? "filter_complex" : "af"}`, async () => {
    const filter = "acrusher@a=bits=4:mix=0.8";
    const baseline = await run(filter, complex);
    const named = await run(`asendcmd=c='0.016 acrusher@a bits 3',${filter}`, complex);
    const all = await run(`asendcmd=c='0.016 all bits 3',${filter}`, complex);
    const missing = await run(`asendcmd=c='0.016 missing bits 3',${filter}`, complex);
    // Native FFmpeg 7.0.2 PCM16 output for all 64 stereo frames.
    assert.equal(createHash("sha256").update(baseline).digest("hex"),
      "2a517b9333febe221a19d04ee48668380b80e75225705fc89d9cddebd17968d2");
    assert.equal(createHash("sha256").update(named).digest("hex"),
      "ff428bd204d2525e546622cda4e281b271dffa5b93ea98031e69e1a0aaecf5aa");
    assert.deepEqual(missing, baseline);
    assert.deepEqual(all, named);
    assert.deepEqual(all.subarray(0, 16 * 4), baseline.subarray(0, 16 * 4));
    assert.equal(all.readInt16LE(16 * 4), -3585);
    assert.equal(baseline.readInt16LE(16 * 4), -3350);
  });

  it(`routes all bits to the first crusher through ${complex ? "filter_complex" : "af"}`, async () => {
    const filters = "acrusher@a=bits=4:mix=0.8,acrusher@b=bits=5:mix=0.6";
    const named = await run(`asendcmd=c='0.016 acrusher@a bits 3',${filters}`, complex);
    assert.deepEqual(await run(`asendcmd=c='0.016 all bits 3',${filters}`, complex), named);
    assert.notDeepEqual(await run(`asendcmd=c='0.016 acrusher@b bits 3',${filters}`, complex), named);
  });
}
