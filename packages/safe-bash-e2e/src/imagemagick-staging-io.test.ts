import assert from "node:assert/strict";
import { it } from "node:test";
import sharp, { readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorageCache } from "@poe-code/safe-fs/storage";
import { withObjectFileDescriptors, type ObjectFilePublicationStore } from "@poe-code/safe-fs/core";
import { runConvertCli, runMontageCli } from "@poe-platform/safe-bash/commands/imagemagick";

// Synthetic object backend: each write creates a revision and deletes its predecessor.
// The object map models remote storage, not memory retained by the command.
function fixture(controller = new AbortController(), cancelAfter = Infinity) {
    const backing = new MemoryFileSystem(), objects = new Map<string, Uint8Array>();
    const counts = { get: 0, put: 0, delete: 0, readBytes: 0, writeBytes: 0 };
    let serial = 0;
    const store: ObjectFilePublicationStore = {
        async acquire(path) {
            try { await backing.stat(path); } catch (error) { if ((error as { code: string }).code === "ENOENT") return undefined; throw error; }
            const stat = await backing.stat(path), bytes = await backing.readFile(path);
            return { revision: String(stat.revision), stat, async read(position, length) { return bytes.slice(position, position + length); }, async close() {} };
        },
        async publish(path, _revision, source, options) {
            await backing.writeStream(path, source, options);
            return (await store.acquire(path, { access: "read" }))!;
        },
        async createStaging(_path, { chunkBytes }) {
            const pages = new Map<number, string>();
            const remove = (index: number) => { const key = pages.get(index); if (key !== undefined) { counts.delete++; objects.delete(key); pages.delete(index); } };
            return {
                async readPage(index, options) {
                    options?.signal?.throwIfAborted();
                    const key = pages.get(index);
                    if (key === undefined) return undefined;
                    counts.get++; const bytes = objects.get(key)!; counts.readBytes += bytes.length;
                    return bytes.slice();
                },
                async writePage(index, bytes, options) {
                    options?.signal?.throwIfAborted();
                    const key = String(++serial); objects.set(key, bytes.slice()); counts.put++; counts.writeBytes += bytes.length;
                    remove(index); pages.set(index, key);
                    if (counts.put === cancelAfter) controller.abort(new Error("cancel scratch I/O"));
                },
                async truncate(size) { for (const index of pages.keys()) if (index * chunkBytes >= size) remove(index); },
                async close() { for (const index of pages.keys()) remove(index); }
            };
        }
    };
    const fs = withObjectFileDescriptors(backing, store, { chunkBytes: 65536, maxStagedBytes: 65536, maxStagedPages: 1, maxOpenFiles: 32, maxFileBytes: 100 * 1024 * 1024 });
    return { backing, fs, objects, counts, controller };
}

for (const format of ["png", "jpeg"] as const) {
    for (const operation of ["resize", "append", "montage"] as const) {
        it(`${format} ${operation} batches object scratch I/O within a fixed working set`, async t => {
            const host = fixture();
            for (const [name, width, height, start, end] of [["a", 1254, 1254, [255, 0, 0], [0, 0, 255]], ["b", 1024, 1536, [0, 128, 0], [255, 255, 0]], ["c", 1254, 1254, [0, 0, 255], [255, 255, 255]]] as const) {
                const pixels = new Uint8Array(width * height * 3);
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = Math.round(start[c]! + (end[c]! - start[c]!) * y / (height - 1));
                const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).toFormat(format).toBuffer();
                await host.backing.writeFile("/" + name, bytes);
            }
            let peak = 0;
            const caches = new Set<PagedStorageCache>();
            const retain = PagedStorageCache.prototype.retain;
            t.mock.method(PagedStorageCache.prototype, "retain", function (this: PagedStorageCache, ...args: Parameters<typeof retain>) {
                retain.apply(this, args); caches.add(this); peak = Math.max(peak, this.residentBytes);
            });
            try {
                const input = { filesystem: host.fs, cwd: "/" };
                const result = operation === "montage"
                    ? await runMontageCli(["a", "b", "c", "-thumbnail", "1024x1024", "-geometry", "1024x1024+20+20", "-tile", "3x1", "out.png"], input)
                    : await runConvertCli(operation === "resize" ? ["a", "-resize", "300x300", "out.png"] : ["a", "b", "c", "+append", "out.png"], input);
                assert.equal(result.exitCode, 0);
                const metadata = readImageMetadata(await host.backing.readFile("/out.png"));
                assert.deepEqual([metadata.width, metadata.height], operation === "resize" ? [300, 300] : operation === "append" ? [3532, 1536] : [3192, 1064]);
                assert.equal(host.objects.size, 0);
                assert.equal(host.counts.delete, host.counts.put);
                assert.deepEqual((await host.backing.readdir("/")).map(entry => entry.name).sort(), ["a", "b", "c", "out.png"]);
                console.log(format, operation, host.counts, { peak });
                assert.ok(host.counts.put < (operation === "resize" ? 400 : 2500));
                assert.ok(host.counts.get < (operation === "resize" ? 650 : 4500));
                assert.ok(peak > 0);
                assert.ok(peak <= 1024 * 1024);
                for (const cache of caches) assert.equal(cache.residentBytes, 0);
            } finally { t.mock.restoreAll(); }
        });
    }
}

for (const format of ["png", "jpeg"] as const) it(`discards ${format} object scratch revisions on cancellation without publishing output`, async () => {
    const host = fixture(new AbortController(), 10);
    await host.backing.writeFile("/a", await sharp({ create: { width: 1254, height: 1254, channels: 3, background: "red" } }).toFormat(format).toBuffer());
    await assert.rejects(runConvertCli(["a", "-resize", "300x300", "out.png"], { filesystem: host.fs, cwd: "/" }, undefined, host.controller.signal), { message: "cancel scratch I/O" });
    assert.equal(host.objects.size, 0);
    assert.equal(host.counts.delete, host.counts.put);
    assert.deepEqual((await host.backing.readdir("/")).map(entry => entry.name), ["a"]);
});
