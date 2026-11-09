import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";
import reference from "./fixtures/concat-packets.json" with { type: "json" };

const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] });
const manifest = "ffconcat version 1.0\nfile a.wav\nduration 1\nfile b.wav\nduration 1\n";

async function run(text: string, extra: string[] = [], limits = {}, packets = true) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/clips", { recursive: true });
  await fs.writeFile("/clips/list", new TextEncoder().encode(text));
  await fs.writeFile("/clips/a.wav", wav);
  await fs.writeFile("/clips/b.wav", wav);
  const args = ["-v", "error", ...extra, ...(packets ? ["-show_packets"] : []), "-show_entries", packets ? "packet=pts,duration,size:packet_tags" : "stream=nb_read_packets", "-of", "json", "/clips/list"];
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand({ limits }).execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, output, diagnostic, args };
}

// FFmpeg 7.0.2 / ffprobe N-66595 reference: two one-second, 8 kHz PCM16 WAVs.
for (const explicit of [false, true]) {
  it(`matches all concat reference packets with explicit format ${explicit}`, async () => {
    const result = await run(manifest, explicit ? ["-f", "concat"] : []);
    expect(result.exitCode, result.diagnostic).toBe(0);
    expect(JSON.parse(result.output)).toEqual(reference);

  });
}

it("uses declared durations to position the next clip without trimming packets", async () => {
  const result = await run(manifest.replace("duration 1", "duration 0.5"));
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual(reference.packets.map((packet, i) =>
    i < 4 ? packet : { ...packet, pts: packet.pts - 4000 }));
});

it("infers omitted durations and parses quoted filenames and CRLF", async () => {
  const result = await run("# clips\r\nfile 'a.wav'\r\nfile b\\.wav\r\n", ["-f", "concat"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output)).toEqual(reference);
});

for (const [text, message] of [
  ["ffconcat version 2.0\nfile a.wav\n", "invalid version"],
  ["duration 1\nfile a.wav\n", "duration without file"],
  ["file a.wav\nduration invalid\n", "invalid duration"],
  ["file ../a.wav\n", "Unsafe file name"],
  ["file https://host/a.wav\n", "Unsafe file name"],
  ["file a.wav\nunknown 1\n", "unknown keyword"],
  ["file missing.wav\n", "ENOENT"],
  ["# empty\n", "no files"]
]) it(`rejects invalid concat input: ${message}`, async () => {
  const result = await run(text!, ["-f", "concat"]);
  expect(result.exitCode).toBe(1);
  expect(result.diagnostic).toContain(message);
  expect(result.output).toBe("");
});

it("accounts for manifest and all child bytes together", async () => {
  const result = await run(manifest, ["-f", "concat"], { maxInputBytes: wav.length * 2 });
  expect(result.exitCode).toBe(1);
  expect(result.output).toBe("");
});

it("enforces the concat input limit", async () => {
  const result = await run(manifest, [], { maxConcatInputs: 1 });
  expect(result.exitCode).toBe(1);
  expect(result.diagnostic).toContain("maxConcatInputs");
  expect(result.output).toBe("");
});

it("counts concat packets without requesting packet output", async () => {
  const result = await run(manifest, ["-f", "concat", "-count_packets"], {}, false);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).streams).toEqual([{ nb_read_packets: "8" }]);
});
