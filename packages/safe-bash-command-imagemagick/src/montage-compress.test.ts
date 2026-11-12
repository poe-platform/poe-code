import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples; Netpbm permits either
// spaces or newlines between ASCII samples.
const formats = [
  { format: "pbm", plain: "P1 2 1 1 0", binary: "50340a3220310a80" },
  { format: "pgm", plain: "P2 2 1 255 0 255", binary: "50350a3220310a3235350a00ff" },
  { format: "ppm", plain: "P3 2 1 255 0 0 0 255 255 255", binary: "50360a3220310a3235350a000000ffffff" }
];

for (const mode of ["command", "montage-command", "retained", "buffered", "sync"] as const) {
  for (const { format, plain, binary } of formats) {
    for (const fileOutput of [false, true]) {
      it.each([
        { options: ["-compress", "none"], ascii: true },
        { options: ["-compress", "NoNe"], ascii: true },
        { options: [], ascii: false },
        { options: ["-compress", "none", "+compress"], ascii: false }
      ])(`${mode} writes ${format} (file=${fileOutput}): $options`, async ({ options, ascii }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-tile", "x1", "-geometry", "1x1+0+0", "xc:black", "xc:white",
          ...options, "-depth", "8", `${format}:${fileOutput ? "/sheet" : "-"}`];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const command = mode === "command" ? createMagickCommand() : createMontageCommand();
        const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
        const result = mode === "command" || mode === "montage-command" ? await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        const bytes = fileOutput ? mode === "buffered" || mode === "sync" ? files.get("/sheet") : await fs.readFile("/sheet") : stdout;
        expect(bytes).toBeDefined();
        if (fileOutput) expect(stdout?.length ?? 0).toBe(0);
        if (ascii) expect(Buffer.from(bytes!).toString().trim().split(/\s+/).join(" ")).toBe(plain);
        else expect(Buffer.from(bytes!).toString("hex")).toBe(binary);
      });
    }
  }

  if (mode !== "buffered" && mode !== "retained" && mode !== "sync") continue;
  it.each([
    { options: ["-compress"], error: "missing argument for -compress" },
    { options: ["-compress", "invalid", "/sheet.pgm"], error: "unsupported compression 'invalid'" }
  ])(`${mode} rejects invalid compression without replacing output: $options`, async ({ options, error }) => {
    const original = new TextEncoder().encode("original"), files = new Map([["/sheet.pgm", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/sheet.pgm", original);
    const args = ["xc:black", ...options];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await filesystem.readFile("/sheet.pgm") : files.get("/sheet.pgm")).toEqual(original);
  });
}

for (const mode of ["buffered", "sync", "retained"] as const) {
  it.each(["ppm:-", "/sheet.ppm", "/sheet-%d.ppm"])(`${mode} writes ASCII samples on every montage page to %s`, async target => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["-compress", "None", "-tile", "1x1", "-geometry", "1x1+0+0",
      "xc:red", "xc:blue", "-depth", "16", target];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    const chunks: Uint8Array[] = [];
    if (target === "ppm:-") chunks.push(result.stdoutBytes!);
    else for (const path of target.includes("%d") ? ["/sheet-0.ppm", "/sheet-1.ppm"] : [target]) {
      chunks.push(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!);
    }
    expect(Buffer.concat(chunks).toString().trim().split(/\s+/).join(" "))
      .toBe("P3 1 1 65535 65535 0 0 P3 1 1 65535 0 0 65535");
  });
}

for (const mode of ["command", "montage-command", "retained", "buffered", "sync"] as const) {
  for (const fileOutput of [false, true]) for (const columns of [1, 2]) {
    it.each([
      { options: [], tag: 1 },
      { options: ["-compress", "None"], tag: 1 },
      { options: ["-compress", "LZW"], tag: 5 },
      { options: ["-compress", "Zip"], tag: 8 },
      { options: ["-compress", "RLE"], tag: 32773 },
      { options: ["-compress", "lZw"], tag: 5 },
      { options: ["-compress", "LZW", "+compress"], tag: 1 }
    ])(`${mode} preserves TIFF compression and pixels (file=${fileOutput}, columns=${columns}): $options`, async ({ options, tag }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const args = ["xc:red", "xc:blue", "-tile", `${columns}x1`, "-geometry", "+0+0", "-depth", "8",
        ...options, `tiff:${fileOutput ? "/sheet.tif" : "-"}`];
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const command = mode === "command" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
      const result = mode === "command" || mode === "montage-command" ? await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }) : mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
      const bytes = fileOutput ? mode === "buffered" || mode === "sync" ? files.get("/sheet.tif")! : await fs.readFile("/sheet.tif") : stdout;
      if (fileOutput) expect(stdout.length).toBe(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const littleEndian = bytes[0] === 0x49;
      let pages = 0;
      for (let ifd = view.getUint32(4, littleEndian); ifd !== 0;) {
        expect(pages).toBeLessThan(2 / columns);
        const entries = view.getUint16(ifd, littleEndian);
        let compression: number | undefined;
        for (let n = 0; n < entries; n++) {
          const at = ifd + 2 + n * 12;
          if (view.getUint16(at, littleEndian) === 259) compression = view.getUint16(at + 8, littleEndian);
        }
        expect(compression).toBe(tag);
        const page = bytes.slice();
        new DataView(page.buffer, page.byteOffset, page.byteLength).setUint32(4, ifd, littleEndian);
        const decoded = decodeImage(page);
        expect([decoded.width, decoded.height]).toEqual([columns, 1]);
        expect(Buffer.from(decoded.data).toString("hex"))
          .toBe("ff0000ff0000ffff".slice(pages * columns * 8, (pages + 1) * columns * 8));
        pages++;
        ifd = view.getUint32(ifd + 2 + entries * 12, littleEndian);
      }
      expect(pages).toBe(2 / columns);
    });
  }
}
