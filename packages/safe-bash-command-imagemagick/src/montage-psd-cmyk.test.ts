import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const cmyk of [false, true]) for (const depth of [8, 16]) for (const destination of ["psd:-", "/out.psd"]) {
    it(`writes ${cmyk ? "CMYK" : "RGB"} Photoshop layers at ${depth} bits (${mode}, ${destination})`, async () => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      const args = ["xc:#33669980", "xc:none", "-tile", "2x1", "-geometry", "+0+0", "-depth", String(depth), "-background", "none", ...(cmyk ? ["-colorspace", "CMYK"] : []), destination];
      let result;
      if (mode === "command") {
        const command = createMagickCommand();
        const argumentValues = createCommandArguments(["montage", ...args]);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
          cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { chunks.push(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr, stdoutBytes: Buffer.concat(chunks) };
      } else result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const bytes = destination === "psd:-" ? result.stdoutBytes! : mode === "sync" || mode === "buffered" ? files.get(destination)! : await filesystem.readFile(destination);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getUint16(24)).toBe(cmyk ? 4 : 3);
      expect(view.getUint16(22)).toBe(depth);
      expect([view.getUint32(18), view.getUint32(14)]).toEqual([2, 1]);
      let offset = 30 + view.getUint32(26);
      offset += 4 + view.getUint32(offset);
      const composite = offset + 4 + view.getUint32(offset);
      expect(view.getInt16(offset + 8)).toBe(-1);
      offset += 10;
      const channels = view.getUint16(offset + 16);
      expect(channels).toBe(cmyk ? 5 : 4);
      const ids = Array.from({ length: channels }, (_, i) => view.getInt16(offset + 18 + i * 6));
      expect(ids).toEqual(cmyk ? [0, 1, 2, 3, -1] : [0, 1, 2, -1]);
      const extra = offset + 18 + channels * 6 + 12;
      offset = extra + 4 + view.getUint32(extra);
      // Native 7.1.2-35: inverted ink planes, with straight alpha in its own plane.
      const expected = depth === 8 ? cmyk ? [255, 128, 0, 170, 128] : [51, 102, 153, 128]
        : cmyk ? [65535, 32768, 0, 43690, 32896] : [13107, 26214, 39321, 32896];
      for (const value of expected) {
        expect(view.getUint16(offset)).toBe(0);
        expect(depth === 8 ? bytes[offset + 2] : view.getUint16(offset + 2)).toBe(value);
        offset += 2 + 2 * depth / 8;
      }
      expect(view.getUint16(composite)).toBe(0);
      expect(bytes.length - composite - 2).toBe(channels * 2 * depth / 8);
    });
  }
}

for (const mode of ["sync", "retained"] as const) {
  it(`keeps gray-looking CMYK sheets in CMYK mode (${mode})`, async () => {
    const args = ["xc:white", "-geometry", "+0+0", "-colorspace", "CMYK", "psd:-"];
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = result.stdoutBytes!;
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(24)).toBe(4);
  });
}
