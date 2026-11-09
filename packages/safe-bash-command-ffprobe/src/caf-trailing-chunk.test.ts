import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const tailfree = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c667265650000000000000003616263", "hex");

for (const trailing of [false, true]) {
  it(`matches native CAF duration and sample count with trailing chunk ${trailing}`, async () => {
    const bytes = tailfree.subarray(0, trailing ? 99 : 84);
    const args = ["-v", "error", "-show_entries", "packet=pts,duration,size:stream=sample_rate,duration_ts,nb_frames", "-of", "json", "/in.caf"];
    const expected = {
      packets: [{ pts: 0, duration: 8, size: "16" }],
      streams: [{ sample_rate: "8000", duration_ts: trailing ? 16 : 8, nb_frames: "8" }]
    };
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toMatchObject(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.caf", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toMatchObject(expected);
  });
}
