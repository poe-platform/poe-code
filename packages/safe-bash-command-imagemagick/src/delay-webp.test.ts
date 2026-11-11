import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

it.each([
  { args: ["-delay", "1x24", "a.gif", "-delay", "7x24", "b.gif"], format: "webp", delays: [41, 291] },
  { args: ["-delay", "1x24", "a.gif", "-delay", "7x24", "b.gif"], format: "gif", delays: [40, 290] },
  ...[ ["2x24", 83], ["3x200", 15], ["19x1000", 19], ["100x1000", 100] ].map(([value, delay]) => ({
    args: ["a.gif", "b.gif", "-set", "delay", String(value)], format: "webp", delays: [delay, delay],
  })),
  { args: ["-size", "4x2", "-delay", "7", "xc:red", "-delay", "19", "xc:blue"], format: "webp", delays: [70, 190] },
  { args: ["-delay", "20", "a.gif", "-delay", "30", "b.gif"], format: "webp", delays: [200, 300] },
])("preserves native frame timing: $args -> $format", async ({ args, format, delays }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.gif", first);
  await fs.writeFile("/b.gif", second);
  const path = `/out.${format}`;
  await fs.writeFile(path, new TextEncoder().encode("KEEP"));
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments([...args, path]).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  });
  expect(result).toMatchObject({ exitCode: 0 });
  const bytes = await fs.readFile(path);
  if (format === "webp") {
    const durations: number[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === "ANMF") {
        durations.push(bytes[offset + 20]! + bytes[offset + 21]! * 256 + bytes[offset + 22]! * 65536);
      }
      const length = view.getUint32(offset + 4, true);
      offset += 8 + length + length % 2;
    }
    expect(durations).toEqual(delays);
  } else {
    expect(decodeImage(bytes, { animated: true }).delay).toEqual(delays);
  }
  for (const [page, dominant] of [0, 2].entries()) {
    const frame = decodeImage(bytes, { page });
    expect(frame).toMatchObject({ width: 4, height: 2 });
    expect(frame.data[dominant]).toBeGreaterThan(240);
    expect(frame.data[2 - dominant]).toBeLessThan(15);
  }
});
