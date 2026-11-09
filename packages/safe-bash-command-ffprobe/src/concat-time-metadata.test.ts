import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeWav } from "@poe-code/audio-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

async function run(extra: string[], directives = "duration 1") {
  const fs = new MemoryFileSystem();
  const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] });
  await fs.writeFile("/a.wav", wav);
  await fs.writeFile("/b.wav", wav);
  await fs.writeFile("/list.ffconcat", new TextEncoder().encode(`ffconcat version 1.0\nfile a.wav\n${directives}\nfile_packet_meta camera left\nfile b.wav\nduration 1\n`));
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-f", "concat", ...extra, "-show_packets", "-show_entries", "packet=pts,duration,size:packet_tags", "-of", "json", "/list.ffconcat"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, output, diagnostic };
}

it.each(["default", "0", "1"])("exports optional concat timing metadata: %s", async enabled => {
  const extra = enabled === "default" ? [] : ["-segment_time_metadata", enabled];
  const result = await run(extra);
  expect(result.exitCode, result.diagnostic).toBe(0);
  const packets = JSON.parse(result.output).packets;
  expect(packets.length).toBeGreaterThan(2);
  for (const packet of packets) {
    const first = packet.pts < 8000;
    const tags = { ...(first ? { camera: "left" } : {}), ...(extra.includes("1") ? {
      "lavf.concatdec.start_time": first ? "0" : "1000000", "lavf.concatdec.duration": "1000000"
    } : {}) };
    expect(packet.tags ?? {}).toEqual(tags);
    expect(packet.side_data_list).toEqual(Object.keys(tags).length ? [{ side_data_type: "Strings Metadata" }] : undefined);
  }
  expect(packets.reduce((sum: number, p: { size: string }) => sum + Number(p.size), 0)).toBe(32000);
});

it("uses explicit duration for the next segment start without trimming packets", async () => {
  const result = await run(["-segment_time_metadata", "1"], "duration 2.5");
  expect(result.exitCode, result.diagnostic).toBe(0);
  const packets = JSON.parse(result.output).packets;
  expect(packets.at(-1).tags).toEqual({ "lavf.concatdec.start_time": "2500000", "lavf.concatdec.duration": "1000000" });
  expect(packets[0].tags["lavf.concatdec.duration"]).toBe("2500000");
});

it("infers timing from file duration when no duration directive is present", async () => {
  const result = await run(["-segment_time_metadata", "1"], "");
  expect(result.exitCode, result.diagnostic).toBe(0);
  const packets = JSON.parse(result.output).packets;
  expect(packets[0].tags["lavf.concatdec.duration"]).toBe("1000000");
  expect(packets.at(-1).tags["lavf.concatdec.start_time"]).toBe("1000000");
});

it.each(["2", "invalid"])("rejects invalid segment_time_metadata %s", async value => {
  const result = await run(["-segment_time_metadata", value]);
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toBe("");
  expect(result.diagnostic).toContain("requires 0 or 1");
});
