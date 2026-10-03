import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { withImageInputs } from "./image-input.js";
it("serves cross-page reads from caller-backed stdin without recharging repeated operands", async () => {
    const filesystem = new MemoryFileSystem(), size = 2 * 1024 * 1024 + 19;
    let charged = 0;
    const stdin = (async function* () { const reused = new Uint8Array(4096); for (let offset = 0; offset < size; offset += 4096) {
        const length = Math.min(4096, size - offset);
        for (let i = 0; i < length; i++)
            reused[i] = (offset + i) % 251;
        yield reused.subarray(0, length);
    } })();
    await withImageInputs({ filesystem, cwd: "/", stdin, inputBudget: { check(total) { charged = total; } } }, undefined, new AbortController().signal, async (read) => {
        for (let repeat = 0; repeat < 2; repeat++)
            await read("-", async (source) => { expect(source.size).toBe(size); const bytes = await source.read(16380, 65536); expect(bytes).toEqual(Uint8Array.from({ length: 65536 }, (_, i) => (16380 + i) % 251)); });
    });
    expect(charged).toBe(size);
    expect(await filesystem.readdir("/")).toEqual([]);
});
