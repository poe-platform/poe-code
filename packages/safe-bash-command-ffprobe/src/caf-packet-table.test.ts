import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { cafAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Unchanged CAF inputs and expected results from native FFmpeg 7.0.2.
const cases = [
  { name: "fixedcount.caf", duration: 3, hex: "636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001070616b7400000000000000180000000000000003000000000000000800000000000000006461746100000000000000140000000000650066006700680069006a006b006c" },
  { name: "none.caf", duration: 0, hex: "636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001070616b7400000000000000180000000000000000000000000000000000000000000000006461746100000000000000140000000000650066006700680069006a006b006c" },
  { name: "plain.caf", duration: 8, hex: "636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c" }
];

for (const { name, duration, hex } of cases) {
  it(`reports packet-table duration independently of PCM for ${name}`, async () => {
    const bytes = Buffer.from(hex, "hex");
    const expected = {
      packets: [{ pts: 0, duration: 8, size: "16" }],
      streams: [{ sample_rate: "8000", duration_ts: duration, nb_frames: "8" }]
    };
    expect(cafAst().probe(bytes, { showPackets: true })).toMatchObject(expected);
    const args = ["-v", "error", "-show_entries", "packet=pts,duration,size:stream=sample_rate,duration_ts,nb_frames", "-of", "json", `/${name}`];
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toMatchObject(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile(`/${name}`, bytes);
    let stdout = "", stderr = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject(expected);
  });
}

it("scales fixed packet counts by frames per packet without changing PCM frame count", () => {
  const bytes = Buffer.from(cases[0]!.hex, "hex");
  bytes.writeUInt32BE(4, 36);
  bytes.writeUInt32BE(2, 40);
  expect(cafAst().probe(bytes).streams[0]).toMatchObject({ duration_ts: 6, nb_frames: "8" });
});

it("validates fixed packet-table duration and enforces the duration budget", () => {
  for (const count of [-1n, 9007199254740992n]) {
    const bytes = Buffer.from(cases[0]!.hex, "hex");
    bytes.writeBigInt64BE(count, 64);
    expect(() => cafAst().probe(bytes)).toThrow(/Invalid CAF packet/);
  }
  const bytes = Buffer.from(cases[0]!.hex, "hex");
  bytes.writeBigInt64BE(16000n, 64);
  expect(() => cafAst().probe(bytes, { limits: { maxDurationSeconds: 1 } })).toThrow(/limit/i);
});
