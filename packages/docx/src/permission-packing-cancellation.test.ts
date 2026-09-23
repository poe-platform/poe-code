import { Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-platform/safe-bash";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const code of ["EACCES", "EPERM", "EROFS", "permission"])
it(`packing cancellation wins over ${code} during destination-parent acquisition`, async () => {
  const input = await textFixture('<w:p/>'), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/sentinel": "Retained" }), fs = new MemoryFileSystem();
  await fs.mkdir("/destination"); await fs.writeFile("/destination/output", new TextEncoder().encode("Retained"));
  await api.extractDocumentArchive(input, { outputDir: "/tree", allowPartialOutput: true }, { ...textContext, filesystem: fs });
  const inventory = JSON.parse(new TextDecoder().decode(await fs.readFile("/tree/manifest.json"))), controller = new AbortController(), reason = { cancelled: true }, cause = Object.assign(new Error("Denied"), { code }), stat = fs.lstat.bind(fs);
  const observed: string[] = [];
  vi.spyOn(fs, "lstat").mockImplementation(async (path, options) => { if (path === "/destination") { observed.push(path); controller.abort(reason); throw cause; } return stat(path, options); });
  await expect(api.packDocumentArchive(inventory, { output: "/destination/output", force: true, json: true }, { ...textContext, signal: controller.signal, filesystem: fs, inventoryDirectory: "/tree" })).rejects.toMatchObject({ code: "cancelled", cause: reason });
  expect(observed).toEqual(["/destination"]); expect(await fs.readFile("/destination/output")).toEqual(new TextEncoder().encode("Retained")); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
