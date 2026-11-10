import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// PNG fixtures and formatted output captured with ImageMagick 7.1.2-35 Q16-HDRI.
const fixtures: Record<string, string> = {
  "indexed.png": "iVBORw0KGgoAAAANSUhEUgAAAAYAAAABCAMAAADKFy/CAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURf///woUHgAA/9dudFgAAAABdFJOUwBA5thmAAAAAWJLR0QAiAUdSAAAAAd0SU1FB+oLBwklBHFDtJ0AAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6Mzc6MDQrMDA6MDA59SyaAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjM3OjA0KzAwOjAwSKiUJgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTozNzowNCswMDowMB+9tfkAAAAPSURBVAjXY2BgYGRkZAIAABIABrtUWn8AAAAASUVORK5CYII=",
  "opaque-indexed.png": "iVBORw0KGgoAAAANSUhEUgAAAAYAAAABCAMAAADKFy/CAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAMUExURWQAAABkAAoUHgAA/+MjE6UAAAAHdElNRQfqCwcJJQRxQ7SdAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjM3OjA0KzAwOjAwOfUsmgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOTozNzowNCswMDowMEiolCYAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDk6Mzc6MDQrMDA6MDAfvbX5AAAAD0lEQVQI12NgYGRiYmIGAAAhAAunF9pQAAAAAElFTkSuQmCC",
  "colors.png": "iVBORw0KGgoAAAANSUhEUgAAAAYAAAABCAYAAAD9yd/wAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6Mzc6MTUrMDA6MDBTKCewAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjM3OjE1KzAwOjAwInWfDAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTozNzoxNSswMDowMHVgvtMAAAAhSURBVAjXY0hhYGBgSGFg4BKRa+ASkfvPJSLXwMDw/z8ALVkFeoo1BV0AAAAASUVORK5CYII="
};

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each([
    { name: "indexed.png", expected: "PseudoClass sRGB Alpha|srgba 5.0|3" },
    { name: "opaque-indexed.png", expected: "PseudoClass sRGB |srgb  4.0|4" },
    { name: "colors.png", expected: "DirectClass sRGB Alpha|srgba 4.0|5" }
  ])(`reports storage class and the independent index channel via ${mode}: $name`, async ({ name, expected }) => {
    const input = Buffer.from(fixtures[name]!, "base64");
    const files = new Map([[name, input]]), filesystem = new MemoryFileSystem();
    if (mode === "retained") await filesystem.writeFile(`/${name}`, input);
    for (const identify of [false, true]) {
      const args = identify
        ? ["identify", "-format", "%r|%[channels]|%k", name]
        : [name, "-format", "%r|%[channels]|%k", "info:"];
      const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: expected });
    }
  });

  it(`reports the palette created by -colors via ${mode}`, async () => {
    const input = Buffer.from(fixtures["colors.png"]!, "base64");
    const files = new Map([["colors.png", input]]), filesystem = new MemoryFileSystem();
    if (mode === "retained") await filesystem.writeFile("/colors.png", input);
    const args = ["colors.png", "-colors", "3", "-format", "%r|%[channels]|%k", "info:"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "PseudoClass sRGB Alpha|srgba 5.0|3" });
  });
}
