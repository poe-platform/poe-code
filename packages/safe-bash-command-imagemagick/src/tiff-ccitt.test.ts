import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: -size 23x19 xc:white -fill black -draw 'rectangle 2,3 11,15' -type bilevel -compress Fax/Group4
// mixed: tiffcp -c g3:2d:fill -r 4 -f lsb2msb -B; strips: tiffcp -c g4 -r 4 -f lsb2msb
const fixtures = {
  long4: "SUkqABgAAAAmoD4GgFEgSwVk2D+ACACADQAAAQMAAQAAALgLAAABAQMAAQAAAAMAAAACAQMAAQAAAAEAAAADAQMAAQAAAAQAAAAGAQMAAQAAAAEAAAAKAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQMAAQAAAAMAAAAXAQQAAQAAABAAAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQAAAAAA",
  long: "SUkqACYAAAAAATUB8DQCgAE1AlgrJsGBqBIAATUCWCsmwYGoEgAOAAABAwABAAAAuAsAAAEBAwABAAAAAwAAAAIBAwABAAAAAQAAAAMBAwABAAAAAwAAAAYBAwABAAAAAQAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAQAAABYBAwABAAAAAwAAABcBBAABAAAAHgAAABwBAwABAAAAAQAAACQBBAABAAAABAAAACkBAwACAAAAAAABAAAAAAA=",
  strips: "SUkqADAAAABkBcXnPAACIGSdHPr/AAiAZJ0c+v8ACIBknRz6/wAIgGQFxQMgAAIADQAAAQMAAQAAABcAAAABAQMAAQAAABMAAAACAQMAAQAAAAEAAAADAQMAAQAAAAQAAAAGAQMAAQAAAAEAAAAKAQMAAQAAAAIAAAARAQQABQAAAOYAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQMAAQAAAAQAAAAXAQQABQAAANIAAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQAAAAAACAAAAAgAAAAIAAAACAAAAAcAAAAIAAAAEAAAABgAAAAgAAAAKAAAAA==",
  mixed: "TU0AKgAAAFIAgFlBAYAGgFlBAYByHgCAWedQAIAeAIBZ51AAgB4AgFnnUACAHgCAWedQAIAeAIBZ51AAgB4AgFnnUACAHgCAWUEBgAaAWUEBAAAOAQAAAwAAAAEAFwAAAQEAAwAAAAEAEwAAAQIAAwAAAAEAAQAAAQMAAwAAAAEAAwAAAQYAAwAAAAEAAQAAAQoAAwAAAAEAAgAAAREABAAAAAUAAAEUARIAAwAAAAEAAQAAARUAAwAAAAEAAQAAARYAAwAAAAEABAAAARcABAAAAAUAAAEAARwAAwAAAAEAAQAAASQABAAAAAEAAAAFASkAAwAAAAIAAAABAAAAAAAAAA4AAAAQAAAAEAAAABAAAAALAAAACAAAABYAAAAmAAAANgAAAEY=",
  fax: "SUkqAGIAAAAAATUFAAE1BQABNQUAATXOFAABNc4UAAE1zhQAATXOFAABNc4UAAE1zhQAATXOFAABNc4UAAE1zhQAATXOFAABNc4UAAE1zhQAATXOFAABNQUAATUFAAE1BQAOAAABAwABAAAAFwAAAAEBAwABAAAAEwAAAAIBAwABAAAAAQAAAAMBAwABAAAAAwAAAAYBAwABAAAAAQAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAQAAABYBAwABAAAAEwAAABcBBAABAAAAWgAAABwBAwABAAAAAQAAACQBBAABAAAABAAAACkBAwACAAAAAAABAAAAAAA=",
  group4: "SUkqABgAAAAmoKPnP////////j8AEAEADQAAAQMAAQAAABcAAAABAQMAAQAAABMAAAACAQMAAQAAAAEAAAADAQMAAQAAAAQAAAAGAQMAAQAAAAEAAAAKAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQMAAQAAABMAAAAXAQQAAQAAAA8AAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQAAAAAA",
};
for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each(Object.entries(fixtures))(`decodes native %s TIFF pixels (${mode})`, async (name, encoded) => {
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    const files = new Map([["/in.tif", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.tif", bytes);
    const args = ["/in.tif", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    const image = decodeImage(output);
    const wide = name.startsWith("long"), width = wide ? 3000 : 23, height = wide ? 3 : 19;
    expect([image.width, image.height]).toEqual([width, height]);
    const expected: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const black = wide ? x >= 750 && x <= 2499 && y >= 1 : x >= 2 && x <= 11 && y >= 3 && y <= 15;
      const gray = black ? 0 : 255;
      expected.push(gray, gray, gray, 255);
    }
    expect(Array.from(image.data)).toEqual(expected);
  });
}
