import { expect, it } from "vitest";
import { encodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const format of ["jpeg", "png", "tiff"] as const) {
    for (const [units, unit, x, y] of [
      ["PixelsPerInch", "inch", 300, 150],
      ["PixelsPerCentimeter", "cm", 40, 20],
    ] as const) {
      it(`sets both resolution axes in ${units} (${mode}, ${format})`, async () => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255),
          format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
        await fs.writeFile("/input.png", input);
        const path = `/output.${format}`;
        const args = ["/input.png", "-units", units, "-density", `${x}x${y}`, path];
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
          args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } })
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const meta = readImageMetadata(mode === "buffered" ? files.get(path)! : await fs.readFile(path));
        const scale = format === "png" ? unit === "inch" ? 100 / 2.54 : 100 : 1;
        expect(meta).toMatchObject({ width: 2, height: 1, resolution: {
          x: Math.floor(x * scale), y: Math.floor(y * scale), unit: format === "png" ? "meter" : unit,
        } });
      });
    }
  }
}

for (const mode of ["buffered", "retained"] as const) {
  it(`applies units before input and relabels existing axes in order (${mode})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["-units", "PixelsPerInch", "-size", "2x1", "xc:red",
      "-density", "300x150", "-write", "/inch.tiff", "-units", "PixelsPerCentimeter", "/cm.tiff"],
      mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    for (const unit of ["inch", "cm"] as const) {
      const path = `/${unit}.tiff`;
      expect(readImageMetadata(mode === "buffered" ? files.get(path)! : await fs.readFile(path)))
        .toMatchObject({ resolution: { x: 300, y: 150, unit } });
    }
  });

  it(`rejects invalid resolution units (${mode})`, async () => {
    const result = await runConvertCli(["xc:red", "-units", "invalid", "/out.png"],
      mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("unrecognized units type");
  });
}

for (const mode of ["buffered", "retained", "command"]) {
  for (const [name, options, physical] of [
    ["density then set", ["-density", "100x100", "-set", "units", "PixelsPerCentimeter"], "000027100000271001"],
    ["set then density", ["-set", "units", "PixelsPerCentimeter", "-density", "100x100"], "000027100000271001"],
    ["units control", ["-units", "PixelsPerCentimeter", "-density", "100x100"], "000027100000271001"],
    ["no density", ["-set", "units", "PixelsPerCentimeter"], undefined],
  ] as const) {
    it(`writes physical PNG units without a units text property: ${name} (${mode})`, async () => {
      const input = encodeImage({ width: 1, height: 1, data: Uint8Array.of(200, 89, 30, 255),
        format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
        properties: { note: "original", comment: "hello" } }, { format: "png" }).data;
      const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
      await fs.writeFile("/input.png", input);
      await fs.writeFile("/output.png", new TextEncoder().encode("keep"));
      files.set("/output.png", new TextEncoder().encode("keep"));
      const args = ["/input.png", ...options, "/output.png"];
      const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
      const chunks = new Map<string, string>(), keys: string[] = [];
      for (let offset = 8; offset + 12 <= output.length;) {
        const length = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(0);
        const kind = new TextDecoder().decode(output.subarray(offset + 4, offset + 8));
        const data = output.subarray(offset + 8, offset + 8 + length);
        chunks.set(kind, Buffer.from(data).toString("hex"));
        if (["tEXt", "zTXt", "iTXt"].includes(kind)) keys.push(new TextDecoder().decode(data.subarray(0, data.indexOf(0))));
        offset += length + 12;
      }
      expect(chunks.get("pHYs")).toBe(physical);
      expect(keys).not.toContain("units");
      expect(readImageMetadata(output).properties).toMatchObject({ note: "original", comment: "hello" });
    });
  }
}

for (const mode of ["buffered", "retained", "command"]) {
  for (const [active, assigned, expected] of [
    ["PixelsPerCentimeter", "PixelsPerInch", "PixelsPerCentimeter"],
    ["PixelsPerInch", "PixelsPerCentimeter", "PixelsPerInch"],
    ["PixelsPerInch", "marker", "PixelsPerInch"],
    [undefined, "marker", "Undefined"],
    ["PixelsPerInch", "PixelsPerInch", "PixelsPerInch"],
    ["PixelsPerCentimeter", "PixelsPerCentimeter", "PixelsPerCentimeter"],
    [undefined, "PixelsPerCentimeter", "PixelsPerCentimeter"],
    ["Undefined", "PixelsPerCentimeter", "PixelsPerCentimeter"],
  ] as const) {
    it(`sets units ${assigned} with active ${active ?? "default"} (${mode})`, async () => {
      const keep = new TextEncoder().encode("KEEP");
      const fs = new MemoryFileSystem(), files = new Map([["/out", keep]]);
      await fs.writeFile("/out", keep);
      const args = ["xc:red", "-density", "120", ...(active ? ["-units", active] : []),
        "-set", "units", assigned, "-format", "%x/%y/%U;", "info:/out"];
      const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
      expect(new TextDecoder().decode(output)).toBe(`120/120/${expected};`);
    });
  }
}

for (const mode of ["buffered", "retained"] as const) {
  it(`uses the units active at each property assignment (${mode})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["xc:red", "-density", "120", "-set", "units", "PixelsPerCentimeter",
      "-set", "units", "marker", "-write", "/first.tiff", "-units", "PixelsPerInch", "-set", "units", "marker", "/second.tiff"],
      mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    for (const [path, unit] of [["/first.tiff", "cm"], ["/second.tiff", "inch"]] as const) {
      expect(readImageMetadata(mode === "buffered" ? files.get(path)! : await fs.readFile(path)))
        .toMatchObject({ resolution: { x: 120, y: 120, unit } });
    }
  });
}
