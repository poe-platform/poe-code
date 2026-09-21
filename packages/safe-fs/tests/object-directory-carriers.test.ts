import { expect, it, vi } from "vitest";
import { BytePath } from "../src/contracts/object.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";

it("serializes the indexed directory entries and owned octets it admitted", async () => {
  const bytes = Uint8Array.of(255, 128);
  const octetIterator = vi.fn(function* () { yield 47; });
  bytes[Symbol.iterator] = octetIterator;
  const entries = [{ name: { bytes: () => bytes } as BytePath, type: "file" as const }];
  const entryIterator = vi.fn(function* () {
    yield entries[0]!;
    yield entries[0]!;
  });
  entries[Symbol.iterator] = entryIterator;
  const authority = new ObjectAuthority({ objects: {
    async open() { throw new Error("Not used"); },
    async readdir() { return entries; },
  } }, { maxHandles: 1 });
  try {
    expect(await authority.readdir(new BytePath(Uint8Array.of(47)), 1))
      .toEqual([{ name: [255, 128], type: "file" }]);
    expect(entryIterator).not.toHaveBeenCalled();
    expect(octetIterator).not.toHaveBeenCalled();
  } finally { await authority.dispose(); }
});

it("rejects an actual slash even when backend octet validation is overridden", async () => {
  const bytes = Uint8Array.of(97, 47, 98);
  bytes.includes = vi.fn(() => false);
  const authority = new ObjectAuthority({ objects: {
    async open() { throw new Error("Not used"); },
    async readdir() { return [{ name: { bytes: () => bytes } as BytePath, type: "file" }]; },
  } }, { maxHandles: 1 });
  try {
    await expect(authority.readdir(new BytePath(Uint8Array.of(47)), 1))
      .rejects.toMatchObject({ code: "EIO" });
    expect(bytes.includes).not.toHaveBeenCalled();
  } finally { await authority.dispose(); }
});
