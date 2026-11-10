import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["command", "sync"] as const) {
  for (const lossless of [false, true]) {
    for (const write of [false, true]) {
      it.each([
        { args: ["-delay", "0", "/a.gif", "-delay", "20", "/b.gif"], delays: [100, 200], format: "webp" },
        { args: ["-delay", "20", "/a.gif", "-delay", "0", "/b.gif"], delays: [200, 100], format: "webp" },
        { args: ["/a.gif", "/b.gif", "-set", "delay", "0"], delays: [100, 100], format: "webp" },
        { args: ["/a.gif", "/b.gif", "-set", "delay", "9x1000"], delays: [100, 100], format: "webp" },
        { args: ["/a.gif", "/b.gif", "-set", "delay", "10x1000"], delays: [10, 10], format: "webp" },
        { args: ["-delay", "0", "/a.gif", "-delay", "20", "/b.gif"], delays: [0, 200], format: "gif" },
      ])(`encodes short frame timing (${mode}, lossless=${lossless}, write=${write}): $args -> $format`, async ({ args, delays, format }) => {
        const path = `/out.${format}`;
        const files = new Map<string, Uint8Array>([["/a.gif", first], ["/b.gif", second], [path, new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const argv = [...args, "-define", `webp:lossless=${lossless}`, ...(write ? ["-write", path, "null:"] : [path])];
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "sync" ? files.get(path)! : await fs.readFile(path);
        if (format === "webp") {
          const actual: number[] = [];
          const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
          for (let at = 12; at + 8 <= output.length;) {
            const size = view.getUint32(at + 4, true);
            if (new TextDecoder().decode(output.subarray(at, at + 4)) === "ANMF") {
              actual.push(output[at + 20]! + output[at + 21]! * 256 + output[at + 22]! * 65536);
            }
            at += 8 + size + (size & 1);
          }
          expect(actual).toEqual(delays);
        } else expect(decodeImage(output, { animated: true }).delay).toEqual(delays);
        for (const page of [0, 1]) {
          const frame = decodeImage(output, { page });
          expect(frame.data[page === 0 ? 0 : 2]).toBeGreaterThan(240);
          expect(frame.data[page === 0 ? 2 : 0]).toBeLessThan(15);
        }
      });
    }
  }
}
