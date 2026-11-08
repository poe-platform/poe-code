import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const dump = "\n00000000: 0001 0203 0405 0607 0809 0a0b 0c0d 0e0f  ................\n00000010: 1011 1213 1415 1617 1819 1a1b 1c1d 1e1f  ................\n";
for (const route of ["file", "stdin", "explicit", "sync", "readFile-only"]) {
  it(`shows the exact WAV packet payload through ${route}`, async () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
    bytes.set(Uint8Array.from({ length: 32 }, (_, i) => i), 44);
    const args = ["-v", "error", "-of", "json", "-show_data", "-show_entries", "packet=data,size",
      ...(route === "explicit" ? ["-f", "wav"] : []), route === "stdin" ? "-" : "/input.wav"];
    let output = "", error = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs: route === "readFile-only" ? new Proxy(fs, { get(target, key) {
          if (key === "openReadFile" || key === "readStream") return undefined;
          const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } }) : fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
      });
      expect(error).toBe(""); expect(result.exitCode).toBe(0);
    }
    expect(JSON.parse(output)).toEqual({ packets: [{ size: "32", data: dump }] });
  });
}

it("pads a partial row and prints only ASCII printable bytes", async () => {
  const { packetHexRows } = await import("./packet-data.js");
  expect([...packetHexRows(Uint8Array.of(32, 65, 126, 127, 255))].join(""))
    .toBe("00000000: 2041 7e7f ff                              A~..\n");
});

for (const fields of ["data", "size"]) it(`honors output limits and field selection for ${fields}`, async () => {
  const bytes = encodeWav({ sampleRate: 44100, channels: [new Float64Array(8192)] });
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
  let output = "", error = "";
  const result = await createFfprobeCommand({ limits: { maxOutputBytes: 256 } }).execute({
    command: "ffprobe", ...createCommandArguments(["-of", "json", "-show_data", "-show_entries", `packet=${fields}`, "/input.wav"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
  });
  if (fields === "data") {
    expect(result.exitCode).toBe(1); expect(output).toBe(""); expect(error).toContain("limit");
  } else {
    expect(error).toBe(""); expect(result.exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({ packets: [{ size: "8192" }, { size: "8192" }] });
  }
});

it("reads encoded MP3 packet bytes after ID3 metadata", async () => {
  const bytes = new Uint8Array(10 + 417 * 2);
  bytes.set([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
  bytes.set([255, 251, 144, 0], 10); bytes.set([255, 251, 144, 0], 427);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.mp3", bytes);
  let output = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-of", "json", "-show_data", "-show_entries", "packet=data,size", "/input.mp3"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  expect(result.exitCode).toBe(0);
  const packets = JSON.parse(output).packets;
  expect(packets).toHaveLength(2);
  for (const packet of packets) {
    expect(packet.size).toBe("417");
    expect(packet.data.startsWith("\n00000000: fffb 9000 0000 0000 0000 0000 0000 0000  ................\n")).toBe(true);
    expect(packet.data).toContain("000001a0: 00");
  }
});
