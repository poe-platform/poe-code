import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { webvttAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe reports side-data types, without including their text in the payload.
const input = "WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n";
const bytes = new TextEncoder().encode(input);
const sideData = [{ side_data_type: "WebVTT ID" }, { side_data_type: "WebVTT Settings" }];
const args = ["-v", "error", "-show_packets", "-of", "json"];

it.each(["voices.vtt", "-"])("reports WebVTT packet side data from %s", async target => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/voices.vtt", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([...args, target]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(diagnostic).toBe("");
  const packets = JSON.parse(output).packets;
  expect(packets).toHaveLength(2);
  expect(packets[0]).toMatchObject({ pts: 1250, duration: 1500, size: "7", side_data_list: sideData });
  expect(packets[1]).toMatchObject({ pts: 4000, duration: 500, size: "5" });
  expect(packets[1]).not.toHaveProperty("side_data_list");
});

it.each([
  { identifier: "cue α", settings: "align:start", expected: sideData },
  { identifier: "cue α", settings: "", expected: sideData.slice(0, 1) },
  { identifier: "", settings: "align:start", expected: sideData.slice(1) },
  { identifier: "", settings: "", expected: undefined }
])("keeps identifier '$identifier' and settings '$settings' separate from the caption", ({ identifier, settings, expected }) => {
  const data = new TextEncoder().encode(`WEBVTT\n\n${identifier ? identifier + "\n" : ""}00:01.250 --> 00:02.750${settings ? " " + settings : ""}\nOne\nTwo\n`);
  const sample = webvttAst().parse(data).tracks[0]!.samples[0]!;
  expect(new TextDecoder().decode(sample.data)).toBe("One\nTwo");
  expect(sample.webvtt).toEqual({ identifier, settings });
  const output = evalSyncFfprobe(data, [...args, "voices.vtt"], () => data);
  expect(output).toBeDefined();
  const packet = JSON.parse(output!).packets[0];
  expect(packet.size).toBe("7");
  expect(packet.side_data_list).toEqual(expected);
  if (!expected) expect(packet).not.toHaveProperty("side_data_list");
});

it.each([
  { entries: "packet=size", expected: [{ size: "7", side_data_list: sideData }, { size: "5" }] },
  { entries: "packet=:packet_side_data=side_data_type", expected: [{ side_data_list: sideData }, {}] },
  { entries: "packet=size:packet_side_data=", expected: [{ size: "7" }, { size: "5" }] }
])("selects WebVTT packet side data with $entries", ({ entries, expected }) => {
  const output = evalSyncFfprobe(bytes, [...args, "-show_entries", entries, "voices.vtt"], () => bytes);
  expect(JSON.parse(output!).packets).toEqual(expected);
});
