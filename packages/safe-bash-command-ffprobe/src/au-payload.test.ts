import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const annotation of [Buffer.alloc(0), Buffer.from("note\0\0\0\0")]) {
  for (const length of [8, 648]) {
    for (const mode of ["hash", "data"] as const) {
      it(`exposes AU ${mode} for ${length} payload bytes after ${annotation.length} annotation bytes`, async () => {
        const offset = 24 + annotation.length;
        const bytes = Buffer.alloc(offset + length);
        [0x2e736e64, offset, length, 3, 8000, 1].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
        annotation.copy(bytes, 24);
        bytes.fill(Buffer.from("000101fffc1903e8", "hex"), offset);
        const args = ["-v", "error", ...(mode === "hash"
          ? ["-show_data_hash", "sha256", "-show_entries", "packet=data_hash"]
          : ["-show_packets", "-show_data"]), "-of", "json"];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.au", bytes);
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments([...args, "/in.au"]), cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        const packets = JSON.parse(output).packets;
        expect(packets).toHaveLength(Math.ceil(length / 640));
        if (mode === "hash") {
          expect(packets).toEqual(Array.from({ length: Math.ceil(length / 640) }, (_, index) => ({
            data_hash: `SHA256:${createHash("sha256").update(bytes.subarray(offset + index * 640, offset + (index + 1) * 640)).digest("hex")}`
          })));
          expect(packets.at(-1).data_hash).toBe("SHA256:e547859e610d15f3f4e5107362a44d6a664e0a0b3504a6c93366e60ed8457506");
        } else {
          expect(packets.at(-1)).toMatchObject({
            pos: String(offset + length - 8), size: "8",
            data: "\n00000000: 0001 01ff fc19 03e8                      ........\n"
          });
        }
        expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!)).toEqual(JSON.parse(output));
      });
    }
  }
}
