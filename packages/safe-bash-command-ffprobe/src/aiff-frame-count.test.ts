import { expect, it } from "vitest";
import { aiffAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe: -count_frames -count_packets -show_entries
// stream=nb_frames,nb_read_frames,nb_read_packets -of json.
const fixtures = [
  { name: "plain", declared: 5, samples: 5 },
  { name: "short COMM declaration", declared: 3, samples: 5 },
  { name: "empty", declared: 0, samples: 0 },
  { name: "zero declaration with audio", declared: 0, samples: 5 }
];

for (const { name, declared, samples } of fixtures) {
  const bytes = Buffer.alloc(54 + samples * 2);
  Buffer.from("464f524d0000003841494646434f4d4d000000120001000000050010400bfa0000000000000053534e44000000120000000000000000", "hex").copy(bytes);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  bytes.writeUInt32BE(declared, 22);
  bytes.writeUInt32BE(8 + samples * 2, 42);
  const records = samples ? 1 : 0;

  it(`keeps declared AIFF sample counts separate from read records in the SDK: ${name}`, () => {
    const stream = aiffAst().probe(bytes).streams[0]!;
    expect(stream.nb_frames).toBe(declared ? String(declared) : undefined);
    expect(stream.nb_read_packets).toBe(String(records));
    expect(stream.nb_read_frames).toBe(String(records));
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    for (const count of [false, true]) {
      it(`reports AIFF counts for ${name} through ${route}, count=${count}`, async () => {
        const args = ["-v", "error", ...(count ? ["-count_frames", "-count_packets"] : []),
          "-show_entries", "stream=nb_frames,nb_read_frames,nb_read_packets", "-of", "json",
          ...(route === "explicit" ? ["-f", "aiff"] : []), route === "stdin" ? "-" : "/input.aiff"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input.aiff", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe("");
        }
        expect(JSON.parse(output).streams).toEqual([{
          ...(declared ? { nb_frames: String(declared) } : {}),
          ...(count && records ? { nb_read_frames: String(records), nb_read_packets: String(records) } : {})
        }]);
      });
    }
  }
}

// AIFF-C IMA COMM counts blocks, while duration counts decoded samples.
it("preserves an AIFF-C IMA declaration independently of packet count and duration", () => {
  const bytes = Buffer.from("464f524d00000062414946434656455200000004a2805140434f4d4d000000180001000000030004400bfa00000000000000696d6134000053534e440000002a00000000000000000000f7f7828080808000080808088880808080800000000000000000000000000000", "hex");
  expect(aiffAst().probe(bytes).streams[0]).toMatchObject({
    nb_frames: "3", duration_ts: 192, nb_read_frames: "1", nb_read_packets: "1"
  });
  const output = evalSyncFfprobe(bytes, ["-count_frames", "-count_packets", "-show_entries",
    "stream=nb_frames,nb_read_frames,nb_read_packets", "-of", "json", "-"])!;
  expect(JSON.parse(output).streams).toEqual([{ nb_frames: "3", nb_read_frames: "1", nb_read_packets: "1" }]);
});

for (const mode of ["auto", "always", "never"]) {
  it(`renders unavailable empty AIFF counts with optional fields ${mode}`, () => {
    const bytes = Buffer.from("464f524d0000002e41494646434f4d4d000000120001000000000010400bfa0000000000000053534e44000000080000000000000000", "hex");
    const output = evalSyncFfprobe(bytes, ["-count_frames", "-count_packets", "-show_optional_fields", mode,
      "-show_entries", "stream=nb_frames,nb_read_frames,nb_read_packets", "-of", "json", "-"])!;
    expect(JSON.parse(output).streams).toEqual([mode === "always"
      ? { nb_frames: "N/A", nb_read_frames: "N/A", nb_read_packets: "N/A" } : {}]);
  });
}
