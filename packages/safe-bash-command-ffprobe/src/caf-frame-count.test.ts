import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { cafAst } from "@poe-code/mp4-ast";
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

for (const count of [false, true]) {
  it(`reports CAF sample frames through synchronous and filesystem ffprobe (count=${count})`, async () => {
    const expected = {
      streams: [{ sample_rate: "8000", duration_ts: 8, nb_frames: "8",
        ...(count ? { nb_read_packets: "1", nb_read_frames: "1" } : {}) }],
      packets: [{ pts: 0, duration: 8, size: "16" }]
    };
    const args = ["-v", "error", ...(count ? ["-count_packets", "-count_frames"] : []),
      "-show_entries", "packet=pts,duration,size:stream=sample_rate,duration_ts,nb_frames" +
        (count ? ",nb_read_packets,nb_read_frames" : ""), "-of", "json", "/plain.caf"];
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => input)!)).toMatchObject(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/plain.caf", input);
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
