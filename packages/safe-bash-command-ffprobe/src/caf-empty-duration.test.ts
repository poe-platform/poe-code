import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { cafAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe omits unknown duration for this empty, fixed-packet LPCM CAF.
const header = "636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000400000001000000020000001064617461000000000000000400000000";

for (const samples of [0, 4]) {
  it(`reports duration and bitrate for a ${samples}-sample CAF`, async () => {
    const bytes = Buffer.concat([Buffer.from(header, "hex"), Buffer.alloc(samples * 4)]);
    bytes.writeBigInt64BE(BigInt(4 + samples * 4), 56);
    const args = ["-v", "error", "-show_streams", "-show_format", "-show_packets", "-of", "json", "/in.caf"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.caf", bytes);
    let stdout = "", stderr = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    for (const probe of [JSON.parse(stdout), JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!),
      cafAst().probe(bytes, { showPackets: true })]) {
      expect(probe.streams[0].duration_ts).toBe(samples || undefined);
      expect(probe.streams[0].duration).toBe(samples ? "0.000500" : undefined);
      expect(probe.streams[0].nb_frames).toBe(samples ? "4" : undefined);
      expect(probe.format.duration).toBe(samples ? "0.000500" : undefined);
      expect(probe.format.size).toBe(String(bytes.length));
      expect(probe.format.bit_rate).toBe(samples ? "1344000" : "256000");
      expect(probe.packets).toHaveLength(samples ? 1 : 0);
    }
    expect(cafAst().parse(bytes).tracks[0]!.decodedAudio!.channelData[0]).toHaveLength(samples);
  });
}
