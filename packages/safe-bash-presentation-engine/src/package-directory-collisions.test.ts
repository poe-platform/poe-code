import { describe, expect, it } from "vitest";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readPackage } from "./package-reader.js";

const context = {
  limits: { maxBytes: 8192, maxReads: 100, chunkBytes: 512 },
  archiveLimits: { maxArchiveBytes: 8192, maxEntryBytes: 1024, maxTotalBytes: 4096, maxMembers: 10, maxPathBytes: 128, maxDepth: 8, maxPaxBytes: 512, maxTextBytes: 1024, chunkSize: 512 }
};
describe("package directory admission", () => {
  it.each([false, true])("rejects explicit directory and regular-file alias in either order %s", async reverse => {
    const members = [{ name: "assets/", bytes: new Uint8Array(), mode: 0o40755 }, { name: "ASSETS", bytes: Uint8Array.of(7) }];
    await expect(readPackage(storedArchive(reverse ? members.reverse() : members), context)).rejects.toMatchObject({ code: "invalid-opc" });
  });
  it.each([false, true])("rejects a regular file above an explicit empty directory in either order %s", async reverse => {
    const members = [{ name: "assets/cache/", bytes: new Uint8Array(), mode: 0o40755 }, { name: "assets", bytes: Uint8Array.of(7) }];
    await expect(readPackage(storedArchive(reverse ? members.reverse() : members), context)).rejects.toMatchObject({ code: "invalid-opc" });
  });
  it("retains valid explicit parent directories as archive records without exposing them as parts", async () => {
    const reader = await readPackage(storedArchive([{ name: "assets/", bytes: new Uint8Array(), mode: 0o40755 }, { name: "assets/item.bin", bytes: Uint8Array.of(7) }]), context);
    expect(reader.entryCount).toBe(2);
    expect(reader.names).toEqual(["/assets/item.bin"]);
    expect(reader.get("/assets/item.bin")).toEqual(Uint8Array.of(7));
  });
});
