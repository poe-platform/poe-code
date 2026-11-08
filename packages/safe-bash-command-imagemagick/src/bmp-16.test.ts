import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
    { name: "RGB555", base64: "Qk1GAAAAAAAAADYAAAAoAAAAAwAAAAIAAAABABAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAA/38AABBCAAAAfOADHwAAAA==", gray: [132, 132, 132] },
    { name: "RGB565", base64: "Qk1SAAAAAAAAAEIAAAAoAAAAAwAAAAIAAAABABAAAwAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAPgAAOAHAAAfAAAA//8AABCEAAAA+OAHHwAAAA==", gray: [132, 130, 132] }
];
for (const fixture of fixtures) for (const topDown of [false, true]) for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`converts padded ${fixture.name} rows to PNG (${mode}, topDown=${topDown})`, async () => {
        const bytes = Buffer.from(fixture.base64, "base64");
        if (topDown) {
            bytes.writeInt32LE(-2, 22);
            const offset = bytes.readUInt32LE(10), rows = Buffer.from(bytes.subarray(offset));
            bytes.set(rows.subarray(8), offset);
            bytes.set(rows.subarray(0, 8), offset + 8);
        }
        const files = new Map<string, Uint8Array>([["/in.bmp", bytes]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", bytes);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual([
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
            255, 255, 255, 255, 0, 0, 0, 255, ...fixture.gray, 255
        ]);
    });
}
