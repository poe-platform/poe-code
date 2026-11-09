import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMp4, scanMp4Packets } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/m4a-cover.m4a", import.meta.url));
const document = parseMp4(bytes);
const art = document.metadata.coverArt!.data;

it("counts the attached picture toward the packet scanner's stream limit", async () => {
  const source = { size: bytes.length, async read(offset: number, length: number) {
    return bytes.subarray(offset, offset + length);
  } };
  await expect((async () => {
    for await (const packet of scanMp4Packets(source, { limits: { maxStreams: 1 } })) void packet;
  })()).rejects.toThrow("maxStreams");
});

for (const route of ["file", "explicit", "stdin", "sync"]) {
  for (const interval of [false, true]) {
    if (route === "sync" && interval) continue;
    for (const data of [false, true]) {
      it(`emits the MP4 artwork packet through ${route}, interval=${interval}, data=${data}`, async () => {
        const args = ["-v", "error", "-of", "json", "-select_streams", "1",
          "-show_entries", `packet=stream_index,size${data ? ",data,data_hash" : ""}`,
          ...(data ? ["-show_data", "-show_data_hash", "sha256"] : []),
          ...(interval ? ["-read_intervals", "%+#2"] : []),
          ...(route === "explicit" ? ["-f", "mp4", "-show_streams"] : []),
          route === "stdin" ? "-" : "/art.m4a"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/art.m4a", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
        }
        const packets = JSON.parse(output).packets;
        expect(packets).toHaveLength(1);
        expect(packets[0]).toMatchObject({ stream_index: 1, size: "219" });
        if (data) {
          expect(packets[0].data_hash).toBe("SHA256:64c128ecc4e8795d71a95f8eacdb4f755326f45b1fb4361b368d6d5147f766d1");
          const hex = packets[0].data.trim().split("\n").map((line: string) => line.slice(10, 49).split(" ").join("")).join("");
          expect(Buffer.from(hex, "hex")).toEqual(Buffer.from(art));
        }
      });
    }
  }
}

for (const interval of [false, true]) {
  it(`preserves every AAC payload alongside the artwork, interval=${interval}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/art.m4a", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json",
        "-show_data_hash", "sha256", "-show_entries", "packet=stream_index,size,data_hash:packet_side_data=",
        ...(interval ? ["-read_intervals", "%+#20"] : []), "/art.m4a"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const packets = JSON.parse(output).packets;
    expect(packets).toHaveLength(10);
    expect(packets.filter((packet: { stream_index: number }) => packet.stream_index === 0)).toMatchObject(
      document.tracks[0]!.samples.map(sample => ({ stream_index: 0, size: String(sample.size),
        data_hash: `SHA256:${createHash("sha256").update(sample.data).digest("hex")}` })));
  });
}
