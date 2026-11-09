import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { aacAst } from "@poe-code/mp4-ast";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("./fixtures/adts.aac", import.meta.url));
// Native ffprobe packet boundaries and SHA256 hashes, including ADTS headers.
const reference = JSON.parse(readFileSync(new URL("./fixtures/adts.json", import.meta.url), "utf8"));

it("retains CRC headers and input-relative positions without changing decoded samples", () => {
  // A CRC-protected 12-byte frame, inside a view with a nonzero byteOffset.
  const frame = Buffer.from("fff05080019ffc1234010203", "hex");
  const input = Buffer.concat([Buffer.from([0, 0]), frame]).subarray(2);
  const probe = aacAst().probe(input, { showPackets: true });
  expect(probe.packets).toHaveLength(1);
  expect(probe.packets![0]).toMatchObject({ pos: "0", size: "12" });
  expect(probe.packetData!.get("0:12")).toEqual(input);
  expect(aacAst().parse(input).tracks[0]!.samples[0]!.data).toEqual(input.subarray(9));
  const output = evalSyncFfprobe(undefined, ["-of", "json", "-show_data_hash", "sha256",
    "-show_entries", "packet=data_hash", "/crc.aac"], () => input);
  expect(JSON.parse(output!)).toEqual({ packets: [{
    data_hash: `SHA256:${createHash("sha256").update(input).digest("hex")}`
  }] });
});

for (const route of ["file", "stdin", "explicit", "sync"]) {
  for (const hash of [false, true]) {
    it(`reports native ADTS packets ${hash ? "with hashes" : "without hashes"} through ${route}`, async () => {
      const args = ["-v", "error", "-of", "json", "-show_packets",
        ...(hash ? ["-show_data_hash", "sha256"] : []),
        "-show_entries", "packet=size,pos,data_hash",
        ...(route === "explicit" ? ["-f", "aac"] : []), route === "stdin" ? "-" : "/plain.aac"];
      let output = "", error = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/plain.aac", bytes);
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
      expect(JSON.parse(output)).toEqual(hash ? reference : {
        packets: reference.packets.map(({ size, pos }: { size: string; pos: string }) => ({ size, pos }))
      });
    });
  }
}
