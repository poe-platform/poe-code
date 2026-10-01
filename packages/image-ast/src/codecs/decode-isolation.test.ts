import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { describe, expect, it } from "vitest";
import { decodeImage } from "./index.js";

function ppm(red: number, blue: number): Uint8Array {
  const bytes = new Uint8Array(64);
  const header = new TextEncoder().encode("P6\n1 1\n255\n");
  bytes.set(header);
  bytes.set([red, 0, blue], header.length);
  return bytes;
}

describe("decode isolation", () => {
  it("decodes current contents when the input buffer is overwritten", () => {
    const bytes = ppm(255, 0);
    expect([...decodeImage(bytes).data]).toEqual([255, 0, 0, 255]);
    bytes.set(ppm(0, 255));
    expect([...decodeImage(bytes).data]).toEqual([0, 0, 255, 255]);
  });

  it("does not retain caller mutations to decoded pixels", () => {
    const bytes = ppm(255, 0);
    const first = decodeImage(bytes);
    first.data.fill(0);
    expect(decodeImage(bytes)).toMatchObject({ width: 1, height: 1 });
    expect([...decodeImage(bytes).data]).toEqual([255, 0, 0, 255]);
  });

  it("isolates tenants after a safe-fs file is deleted", async () => {
    const tenantA = new MemoryFileSystem();
    await tenantA.writeFile("/image.ppm", ppm(255, 0));
    const viewA = await tenantA.readFile("/image.ppm");
    expect([...decodeImage(viewA).data]).toEqual([255, 0, 0, 255]);
    await tenantA.unlink("/image.ppm");
    const tenantB = new MemoryFileSystem();
    await tenantB.writeFile("/image.ppm", ppm(0, 255));
    const viewB = await tenantB.readFile("/image.ppm");
    expect([...decodeImage(viewB).data]).toEqual([0, 0, 255, 255]);
  });
});
