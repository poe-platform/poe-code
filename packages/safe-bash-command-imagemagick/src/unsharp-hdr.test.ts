import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`preserves extended-range unsharp samples (${mode})`, async () => {
        const hex = "bf0c5fd8be59ffd840013cf83d1493853f00068e3f8de48c";
        // ImageMagick 7.1.2-35 Q16-HDRI: negative, positive, and over-range samples.
        const input = Buffer.from("50660a3320320a312e300abe8000003e0000003fc000003dcccccd3f00068e3f7ff972", "hex");
        const files = new Map<string, Uint8Array>([["/in.pfm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", input);
        const args = ["/in.pfm", "-unsharp", "0x1", "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
        const header = new TextEncoder().encode("Pf\n3 2\n1.0\n");
        expect(output.subarray(0, header.length)).toEqual(header);
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        const expected = Buffer.from(hex, "hex");
        const reference = new DataView(expected.buffer, expected.byteOffset, expected.byteLength);
        for (let i = 0; i < 6; i++) {
            // Allow float32 rounding differences from native quantum storage.
            expect(view.getFloat32(header.length + i * 4)).toBeCloseTo(reference.getFloat32(i * 4), 6);
        }
    });
}
