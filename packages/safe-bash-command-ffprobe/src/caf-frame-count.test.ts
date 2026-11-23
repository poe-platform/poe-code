import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { cafAst } from "@poe-code/mp4-ast";
import { cafAlac } from "@poe-code/mp4-ast/caf-alac-fixture";
import { cafIma } from "@poe-code/mp4-ast/caf-ima-fixture";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Eight complete mono PCM16 frames, one packet, and no packet table.
// Native FFmpeg 7.0.2 reports nb_frames=8 and nb_read_packets=nb_read_frames=1.
const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c", "hex");

it("reports CAF sample frames independently of demuxed packets in the AST", () => {
  expect(cafAst().probe(input, { showPackets: true })).toMatchObject({
    streams: [{ sample_rate: "8000", duration_ts: 8, nb_frames: "8" }],
    packets: [{ pts: 0, duration: 8, size: "16" }]
  });
});

for (const [name, bytes, duration, packets] of [
  ["PCM", input, 8, 1], ["ALAC", cafAlac, 12288, 3], ["IMA", cafIma, 8256, 129]
] as const) for (const count of [false, true]) {
  it(`reports CAF ${name} sample frames through synchronous and filesystem ffprobe (count=${count})`, async () => {
    const expected = {
      streams: [{ sample_rate: "8000", duration_ts: duration, nb_frames: String(duration),
        ...(count ? { nb_read_packets: String(packets), nb_read_frames: String(packets) } : {}) }],
      ...(name === "PCM" ? { packets: [{ pts: 0, duration: 8, size: "16" }] } : {})
    };
    const args = ["-v", "error", ...(count ? ["-count_packets", "-count_frames"] : []),
      "-show_entries", "packet=pts,duration,size:stream=sample_rate,duration_ts,nb_frames" +
        (count ? ",nb_read_packets,nb_read_frames" : ""), "-of", "json", "/plain.caf"];
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)).toMatchObject(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/plain.caf", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(JSON.parse(output)).toMatchObject(expected);
  });
}
