import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const crusher = "acrusher@c=bits=4:mix=0.2";
// Complete PCM16 output hashes from native FFmpeg; issue cases use 7.0.2.
for (const [filter, hash] of [
  [`${crusher},asetnsamples=n=12:p=0,asendcmd=c=0 acrusher@c bits 2`, "a9f8f7b41d3cea6decd716430d5b9f0412b1106fc8dd6a535587620acbc7fe4d"],
  [`${crusher},asetnsamples=n=12:p=0,asendcmd=c=0.012 acrusher@c bits 2`, "9edcce7622d81e6c8f79ad4361228d15245b8cc32ce00c7c614556a8ad829907"],
  [`${crusher},asetnsamples=n=12:p=0,asetnsamples=n=16:p=0,asendcmd=c=0 acrusher@c bits 2`, "9edcce7622d81e6c8f79ad4361228d15245b8cc32ce00c7c614556a8ad829907"],
  [`${crusher},asetnsamples=n=64:p=0,asendcmd=c=0 acrusher@c bits 2`, "4405a60369365d431186820a22122e5e687416ee628af400e01c477b6962d4c2"],
  [`${crusher},asetnsamples=n=16:p=0,asendcmd=c=0 acrusher@c bits 2`, "a9f8f7b41d3cea6decd716430d5b9f0412b1106fc8dd6a535587620acbc7fe4d"],
  [`${crusher},asetnsamples=n=16:p=0,asendcmd=c=0.016 acrusher@c bits 2`, "c85ffe0d40ce61cdc605103999c1d482557a53713c4c97530c22439a7badb39e"],
  [`${crusher},asetnsamples=n=8:p=0,asendcmd=c=0 acrusher@c bits 2`, "c979a9549e024212e16793e29acbfcbfe8b25ffc60aafc7f4fc72c0b50b551ae"],
  [`${crusher},asetnsamples=n=4:p=0,asendcmd=c=0 acrusher@c bits 2`, "c979a9549e024212e16793e29acbfcbfe8b25ffc60aafc7f4fc72c0b50b551ae"],
  [`asendcmd=c=0.016 acrusher@c bits 2,${crusher}`, "a9f8f7b41d3cea6decd716430d5b9f0412b1106fc8dd6a535587620acbc7fe4d"],
  [`asendcmd=c=0.032 acrusher@c bits 2,${crusher}`, "c85ffe0d40ce61cdc605103999c1d482557a53713c4c97530c22439a7badb39e"],
  [`${crusher},asetnsamples=n=16:p=0,asendcmd=c=0 acrusher@other bits 2`, "4405a60369365d431186820a22122e5e687416ee628af400e01c477b6962d4c2"],
  [crusher, "4405a60369365d431186820a22122e5e687416ee628af400e01c477b6962d4c2"],
  [`asendcmd=c=0.008 acrusher@c bits 2,${crusher}`, "c979a9549e024212e16793e29acbfcbfe8b25ffc60aafc7f4fc72c0b50b551ae"],
  [`asendcmd=c=0.024 acrusher@c bits 2,${crusher}`, "9edcce7622d81e6c8f79ad4361228d15245b8cc32ce00c7c614556a8ad829907"]
]) for (const complex of [false, true]) {
  it(`matches native downstream frame assembly: ${filter} (complex=${complex})`, async () => {
    const fs = createMemoryFileSystem();
    const input = Buffer.alloc(192);
    for (let i = 0; i < 96; i++) input.writeInt16LE((i * 1357) % 60001 - 30000, i * 2);
    await fs.writeFile("/in.raw", input);
    const chunks: Buffer[] = [];
    let stderr = "";
    const chain = `asetnsamples=n=8:p=0,${filter}`;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
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
    assert.equal(output.length, 192);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
