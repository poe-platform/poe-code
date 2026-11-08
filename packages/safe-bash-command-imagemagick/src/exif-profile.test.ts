import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeImage } from "@poe-code/image-ast/portable";
import { crc32 } from "node:zlib";
import { runConvertCli } from "./index.js";

// TIFF IFD0 with out-of-line ASCII values, independent of the EXIF encoder.
function profile(little: boolean): Uint8Array {
  const tags = [[271, "AuditMake"], [272, "AuditCam"], [306, "2024:03:07 01:02:03"], [315, "Example Author"]] as const;
  const bytes = new Uint8Array(160), view = new DataView(bytes.buffer);
  bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
  view.setUint32(4, 8, little); view.setUint16(8, 5, little);
  let offset = 74;
  tags.forEach(([tag, value], index) => {
    const entry = 10 + index * 12, text = new TextEncoder().encode(value + "\0");
    view.setUint16(entry, tag, little); view.setUint16(entry + 2, 2, little);
    view.setUint32(entry + 4, text.length, little); view.setUint32(entry + 8, offset, little);
    bytes.set(text, offset); offset += text.length;
  });
  view.setUint16(58, 274, little); view.setUint16(60, 3, little);
  view.setUint32(62, 1, little); view.setUint16(66, 6, little);
  return bytes.subarray(0, offset);
}

for (const little of [false, true]) for (const input of ["jpeg", "png"] as const) {
  const { data } = encodeImage({ width: 3, height: 2, data: new Uint8Array(24).fill(255), format: input, space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: input });
  const exif = profile(little);
  const segment = input === "png" ? new Uint8Array(exif.length + 12) : Uint8Array.from([255, 225, 0, exif.length + 8, 69, 120, 105, 102, 0, 0, ...exif]);
  if (input === "png") {
    const view = new DataView(segment.buffer);
    view.setUint32(0, exif.length); segment.set([101, 88, 73, 102], 4); segment.set(exif, 8);
    view.setUint32(segment.length - 4, crc32(segment.subarray(4, segment.length - 4)));
  }
  const split = input === "png" ? 33 : 2;
  const fixture = Uint8Array.from([...data.subarray(0, split), ...segment, ...data.subarray(split)]);
  for (const mode of ["buffered", "retained"] as const) for (const output of ["jpg", "png"]) {
    it.each(["rewrite", "orient", "strip", "remove", "remove-all"])(`EXIF %s ${little}/${input}/${mode}/${output}`, async operation => {
      const fs = new MemoryFileSystem(), files = new Map([["/input", fixture]]);
      await fs.writeFile("/input", fixture);
      const path = `/output.${output}`;
      const options = operation === "orient" ? ["-auto-orient"] : operation === "strip" ? ["-strip"] : operation === "remove" ? ["+profile", "exif"] : operation === "remove-all" ? ["+profile", "*"] : [];
      expect(await runConvertCli(["/input", ...options, path], mode === "buffered" ? files : { filesystem: fs, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const bytes = mode === "buffered" ? files.get(path)! : await fs.readFile(path);
      const native = spawnSync("magick", ["identify", "-quiet", "-format", "%[EXIF:Make]|%[EXIF:Model]|%[EXIF:Artist]|%[EXIF:DateTime]|%[orientation]|%wx%h", "-"], { input: bytes, encoding: "utf8" });
      expect(native.status, native.stderr).toBe(0);
      if (operation === "strip" || operation.startsWith("remove")) {
        expect(native.stdout.split("|").slice(0, 4)).toEqual(["", "", "", ""]);
      } else {
        expect(native.stdout).toBe(`AuditMake|AuditCam|Example Author|2024:03:07 01:02:03|${operation === "orient" ? "TopLeft|2x3" : "RightTop|3x2"}`);
      }
    });
  }
}
