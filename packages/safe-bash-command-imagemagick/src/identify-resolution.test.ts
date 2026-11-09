import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each([[72, "28.34"], [150, "59.05"], [300, "118.11"]] as const)(
  "reports native PNG resolution and units at %i DPI",
  async (density, resolution) => {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .withMetadata({ density }).png().toBuffer();
    const args = ["-format", "%[resolution.x]|%[resolution.y]|%x|%y|%[units]", "input.png"];
    const expected = { exitCode: 0, stdout: `${resolution}|${resolution}|${resolution}|${resolution}|PixelsPerCentimeter`, stderr: "" };
    const files = new Map([["input.png", bytes]]);
    expect(await runIdentifyCli(args, files)).toMatchObject(expected);
    expect(runIdentifyCliSync(args, files)).toMatchObject(expected);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", bytes);
    expect(await runIdentifyCli(args, { filesystem, cwd: "/" })).toMatchObject(expected);
  }
);

// PNGs with pHYs (11811, 5906, meters) and (4, 2, unknown), checked with native identify.
it.each([
  ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAC4jAAAXEgGVQubbAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "118.11|59.06|PixelsPerCentimeter"],
  ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAAEAAAAAgA0xQamAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "4|2|Undefined"]
])("preserves independent PNG axes and units (%s)", async (encoded, stdout) => {
  const bytes = Buffer.from(encoded, "base64");
  const args = ["-format", "%[resolution.x]|%[resolution.y]|%[units]", "input.png"];
  expect(await runIdentifyCli(args, new Map([["input.png", bytes]]))).toMatchObject({ exitCode: 0, stdout, stderr: "" });
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", bytes);
  expect(await runIdentifyCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stdout, stderr: "" });
});
