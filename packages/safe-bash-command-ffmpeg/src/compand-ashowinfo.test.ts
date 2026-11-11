import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// PCM16, identity-curve double, and unfiltered references verified with native FFmpeg 7.0.2.
// Default-curve double checksums describe our actual intermediate samples: compand's
// floating-point arithmetic can differ in the low bits from the native build.
// The final default-curve frame also has two observed JS runtime results.
for (const graph of [false, true]) {
  for (const [filter, format, references, pcmHash] of [
    ["compand,ashowinfo", "dblp", [
      ["9C37E62C", "1124F34D D6E9F2D0"], ["EC4D4863", "56BB3E0B AB630A58"],
      ["EB9E1880", "E13E90AE A2AC87C3"], ["F9DA0A3B", "33B9F293 C4951799"]
    ], "8c2a7655f5dbb495c4cb39bde729002e9027d0acdd49f59c8dea73ce3b76d025"],
    ["compand,anull,ashowinfo", "dblp", [
      ["9C37E62C", "1124F34D D6E9F2D0"], ["EC4D4863", "56BB3E0B AB630A58"],
      ["EB9E1880", "E13E90AE A2AC87C3"], ["F9DA0A3B", "33B9F293 C4951799"]
    ], "8c2a7655f5dbb495c4cb39bde729002e9027d0acdd49f59c8dea73ce3b76d025"],
    ["compand=points=-80/-80|0/0,ashowinfo", "dblp", [
      ["37B263C3", "02BCCC5B C54D9759"], ["3AAF4345", "665B791B B2B7CA1B"],
      ["B00C9FB3", "BEE009E7 77DB95CC"], ["3AD8C387", "E78D44D8 268C7EAF"]
    ], "9235c4da23d9a4bed366b693ed892ba7e3a3cb9dc06deb42d74e8edcb576991a"],
    ["compand,aformat=f=s16,ashowinfo", "s16", [
      ["01A9FDD1", "01A9FDD1"], ["8893F9EB", "8893F9EB"],
      ["7E1EFB6E", "7E1EFB6E"], ["5C058512", "5C058512"]
    ], "8c2a7655f5dbb495c4cb39bde729002e9027d0acdd49f59c8dea73ce3b76d025"],
    ["ashowinfo", "s16", [
      ["CED0FD68", "CED0FD68"], ["8AD1FB67", "8AD1FB67"],
      ["653301C7", "653301C7"], ["9AA184A9", "9AA184A9"]
    ], "9235c4da23d9a4bed366b693ed892ba7e3a3cb9dc06deb42d74e8edcb576991a"]
  ] as const) it(`${filter} reports intermediate samples before PCM16 output (${graph ? "graph" : "simple"})`, async () => {
    const levels = [200, 1000, 21000, 8000, 100, 25000, 400];
    const channels = [0, 3].map(offset => Float64Array.from({ length: 1603 }, (_, i) =>
      (i % 6 < 3 ? 1 : -1) * levels[(Math.floor(i / 117) + offset) % levels.length]! / 32768));
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const lines = stderr.trim().split("\n");
    assert.equal(lines.length, references.length);
    for (const [n, [checksum, planes]] of references.entries()) {
      const checksums: string[][] = [[checksum, planes]];
      if (checksum === "F9DA0A3B") checksums.push(["F2FA0A36", "33B9F293 BDB51794"]);
      assert.ok(checksums.some(([sum, planeSums]) => lines[n] ===
        `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} fmt:${format} channels:2 chlayout:stereo rate:8000 nb_samples:${n === 3 ? 67 : 512} checksum:${sum} plane_checksums: [ ${planeSums} ]`), lines[n]);
    }
    assert.equal(createHash("sha256").update(fs.readFileSync("/out.pcm") as Buffer).digest("hex"), pcmHash);
  });
}
