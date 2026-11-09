import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/m4a-cover.m4a", import.meta.url));
const sideData = [{
  side_data_type: "Skip Samples", skip_samples: 1024, discard_padding: 0, skip_reason: 0, discard_reason: 0
}];

// Native ffprobe retains each side-data object even when no fields are selected.
for (const target of ["/input.m4a", "-"]) it.each([
  { entries: "packet=pts", expected: [{}] },
  { entries: "packet=pts:packet_side_data=", expected: [{}] },
  { entries: "packet=pts:packet_side_data=skip_samples", expected: [{ skip_samples: 1024 }] },
  { entries: "packet=pts:packet_side_data", expected: sideData }
])(`projects AAC packet side data with $entries from ${target}`, async ({ entries, expected }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.m4a", bytes);
  const args = ["-v", "error", "-select_streams", "0", "-show_entries", entries, "-of", "json", target];
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-read_intervals", "%+#1", ...args]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(diagnostic).toBe("");
  expect(JSON.parse(output)).toEqual({ packets: [{ pts: -1024, side_data_list: expected }] });

  const packets = JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).packets;
  expect(packets[0]).toEqual({ pts: -1024, side_data_list: expected });
  expect(packets[1]).toEqual({ pts: 0 });
});
