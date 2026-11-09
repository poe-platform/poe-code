import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const pcm = Buffer.from("000000bf0000803e000000000000403f0000003e000080be0000803f000080bf000060bf0000c03e0000000000000000", "hex");
for (const format of ["le", "be", "long", "wav", "bad"]) {
  it(`probes native float32 ${format} through both command APIs`, async () => {
    const bytes = format === "wav" ? Buffer.concat([
      Buffer.from("524946468400000057415645666d74201200000003000200112b0000885801000800200000006661637404000000060000004c4953541a000000494e464f495346540d0000004c61766636312e312e31303000006461746130000000", "hex"), pcm
    ]) : Buffer.alloc(1024 + (format === "long" ? 200 : 1) * pcm.length);
    if (format !== "wav") {
      Buffer.from(format === "le" ? "64a3010000442c460200000004000000" : "0001a364462c44000000000200000004", "hex").copy(bytes);
      const payload = format === "le" ? pcm : Buffer.from(pcm).swap32();
      for (let offset = 1024; offset < bytes.length; offset += payload.length) payload.copy(bytes, offset);
      if (format === "bad") bytes.write("FAIL");
    }
    const args = ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,duration_ts:packet=pts,pos,size,duration:format=format_name", "-of", "json", "/in"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    const syncOutput = evalSyncFfprobe(undefined, args, () => bytes);
    if (format === "bad") {
      expect(result.exitCode).toBe(1);
      expect(diagnostic).not.toBe("");
      expect(output).toBe("");
      expect(syncOutput).toBeUndefined();
      return;
    }
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    const expected = {
      streams: [{ codec_name: format === "le" || format === "wav" ? "pcm_f32le" : "pcm_f32be", sample_rate: "11025", channels: 2, duration_ts: format === "long" ? 1200 : 6 }],
      packets: format === "long" ? [
        { pts: 0, pos: "1024", size: "3528", duration: 441 },
        { pts: 441, pos: "4552", size: "3528", duration: 441 },
        { pts: 882, pos: "8080", size: "2544", duration: 318 }
      ] : [{ pts: 0, pos: format === "wav" ? "92" : "1024", size: "48", duration: 6 }],
      format: { format_name: format === "wav" ? "wav" : "ircam" }
    };
    for (const text of [output, syncOutput]) expect(JSON.parse(text!)).toMatchObject(expected);
  });
}
