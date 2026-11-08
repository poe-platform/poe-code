import { expect, test } from "vitest";
import { MemoryFileSystem, tryReadMemoryFileViewSync } from "../src/fs/memory/index.js";

for (const size of [64, 65536]) {
  test.each(["remove", "replace"])(`released ${size}-byte buffers stay isolated after %s`, async action => {
    const first = new MemoryFileSystem();
    const second = new MemoryFileSystem();
    await first.writeFile("/secret", new Uint8Array(size).fill(17));
    const oldView = tryReadMemoryFileViewSync(first, "/secret")!;
    if (action === "remove") await first.rm("/secret");
    else await first.writeFile("/secret", new Uint8Array(size + 1));
    await second.writeFile("/secret", new Uint8Array(size).fill(93));
    const newView = tryReadMemoryFileViewSync(second, "/secret")!;
    expect(oldView.buffer).not.toBe(newView.buffer);
    expect(new Uint8Array(oldView.buffer).includes(93)).toBe(false);
    oldView.fill(42);
    expect(await second.readFile("/secret")).toEqual(new Uint8Array(size).fill(93));
  });
}

test("small append writes reuse their admitted capacity within one filesystem", async () => {
  for (const options of [{}, { maxRetainedBytes: 100, maxFileBytes: 128 }]) {
    const fs = new MemoryFileSystem(options);
    await fs.appendFile("/f", Uint8Array.of(1));
    const first = tryReadMemoryFileViewSync(fs, "/f")!;
    await fs.appendFile("/f", Uint8Array.of(2));
    const second = tryReadMemoryFileViewSync(fs, "/f")!;
    expect(second.buffer).toBe(first.buffer);
    expect(second).toEqual(Uint8Array.of(1, 2));
    expect(second.buffer.byteLength).toBe(64);
  }
});
