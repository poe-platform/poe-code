import { expect, it, vi } from "vitest";
import * as zip from "@poe-code/office-package/zip";
import { writeDocument } from "./engine.js";

it.each([
  {},
  { text: Infinity, binaryBytes: Infinity },
  { text: 100_000, binaryBytes: 200_000 },
])("passes EPUB text and binary budgets to the ZIP codec: %j", async limits => {
  const create = zip.createZipCodec;
  const observed: zip.ZipLimits[] = [];
  const spy = vi.spyOn(zip, "createZipCodec").mockImplementation((...args) => {
    const codec = create(...args);
    return {
      ...codec,
      makeZipEntry(...entryArgs) {
        observed.push(entryArgs[3]);
        return codec.makeZipEntry(...entryArgs);
      },
      writeZipArchive(...archiveArgs) {
        observed.push(archiveArgs[1]);
        return codec.writeZipArchive(...archiveArgs);
      },
    };
  });
  try {
    const result = await writeDocument({ blocks: [], metadata: {}, resources: [] },
      { to: "epub", yes: true }, { limits, yield: async () => {} });
    expect(result.kind).toBe("binary");
    expect(observed.length).toBeGreaterThan(1);
    for (const actual of observed) {
      expect(actual).toMatchObject({
        maxPathBytes: limits.text ?? Infinity,
        maxTextBytes: limits.text ?? Infinity,
        maxPaxBytes: limits.binaryBytes ?? Infinity,
      });
    }
  } finally {
    spy.mockRestore();
  }
});
