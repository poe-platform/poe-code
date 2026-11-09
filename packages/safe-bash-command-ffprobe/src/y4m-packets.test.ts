import { createHash } from "node:crypto";
import { y4mAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const payloads = ["10171e252c333a41484f565d", "242b323940474e555c636a71", "383f464d545b626970777e85"]
  .map(hex => Buffer.from(hex, "hex"));
const dumps = [
  "1017 1e25 2c33 3a41 484f 565d            ...%,3:AHOV]",
  "242b 3239 4047 4e55 5c63 6a71            $+29@GNU\\cjq",
  "383f 464d 545b 6269 7077 7e85            8?FMT[bipw~."
];

for (const tagged of [false, true]) {
  const bytes = Buffer.concat([
    Buffer.from("YUV4MPEG2 W4 H2 F25:1 Ip A1:1 C420jpeg\n"),
    ...payloads.flatMap((payload, index) => [
      Buffer.from(`FRAME${tagged ? [" Xlong=hello", "", " Xt=12"][index] : ""}\n`), payload
    ])
  ]);
  const positions = tagged ? [57, 75, 99] : [45, 63, 81];

  it(`exposes original Y4M packet views with ${tagged ? "tagged" : "plain"} headers`, () => {
    const probe = y4mAst().probe(bytes, { showPackets: true });
    expect(probe.packets).toHaveLength(3);
    for (const [index, packet] of probe.packets!.entries()) {
      expect(packet).toMatchObject({ pos: String(positions[index]), size: "12" });
      const data = probe.packetData!.get(`${packet.pos}:${packet.size}`)!;
      expect(Buffer.from(data)).toEqual(payloads[index]);
      expect(data.buffer).toBe(bytes.buffer);
      expect(data.byteOffset - bytes.byteOffset).toBe(positions[index]);
    }
    expect(y4mAst().probe(bytes).packetData).toBeUndefined();
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    for (const mode of ["plain", "hash", "data"]) {
      it(`probes ${tagged ? "tagged" : "plain"} Y4M ${mode} packets through ${route}`, async () => {
        const args = ["-v", "error", "-of", "json", "-show_packets",
          ...(mode === "hash" ? ["-show_data_hash", "sha256"] : mode === "data" ? ["-show_data"] : []),
          "-show_entries", "packet=pos,size,data,data_hash",
          ...(route === "explicit" ? ["-f", "yuv4mpegpipe"] : []), route === "stdin" ? "-" : "/in.y4m"];
        let output = "", error = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/in.y4m", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
          });
          expect(error).toBe("");
          expect(result.exitCode).toBe(0);
        }
        expect(JSON.parse(output)).toEqual({ packets: payloads.map((payload, index) => ({
          pos: String(positions[index]), size: "12",
          ...(mode === "hash" ? { data_hash: `SHA256:${createHash("sha256").update(payload).digest("hex")}` } : {}),
          ...(mode === "data" ? { data: `\n00000000: ${dumps[index]}\n` } : {})
        })) });
      });
    }
  }
}
