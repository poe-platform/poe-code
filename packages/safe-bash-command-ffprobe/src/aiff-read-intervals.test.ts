import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// 8 kHz mono PCM16 AIFF, seven SSND offset bytes, 5000 samples.
const bytes = Buffer.alloc(10062);
Buffer.from("464f524d0000274641494646434f4d4d000000120001000013880010400bfa0000000000000053534e440000271f000000070000001000010203040506", "hex").copy(bytes);

for (const [interval, samples] of [
  ["0.25%+#1", [2000]],
  ["0.25%+#3", [2000, 4048]],
  ["0.25%+#1,0%+#1", [2000, 0]],
  ["0.25%+#1,+0.05%+#1", [2000, 4448]],
  ["0.25%+0.3", [2000, 4048]],
  ["%+#3", [0, 2048, 4096]],
  ["0.625%+#1", []],
  ["1%+#1", []],
  ["0.25%+#0", []]
] as const) it(`reads AIFF PCM intervals from exact samples (${interval})`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/long.aiff", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-read_intervals", interval,
      "-show_entries", "packet=pos,size,pts,duration:stream=nb_read_packets", "-count_packets", "-of", "json", "/long.aiff"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ packets: samples.map(pts => ({
    pts, duration: Math.min(2048, 5000 - pts), size: String(Math.min(2048, 5000 - pts) * 2), pos: String(61 + pts * 2)
  })) });
  expect(JSON.parse(output).streams).toEqual([samples.length ? { nb_read_packets: String(samples.length) } : {}]);
});
