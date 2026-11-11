import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        { operation: "-gamma", gamma: "2", hex: "bf0000003eb504f33f9cc4713ea1e89b3f3509963f7ffcb9" },
        { operation: "+gamma", gamma: "0.5", hex: "bf0000003eb504f33f9cc4713ea1e89b3f3509963f7ffcb9" },
        { operation: "-gamma", gamma: "-2", hex: "c0000000403504f33f5105eb404a62c13fb500513f8001a4" },
        { operation: "-gamma", gamma: "0.5", hex: "3d8000003c800000401000003c23d70a3e800d1c3f7ff2e4" },
    ])(`preserves native signed gamma for floating-point samples (${mode}): $operation $gamma`, async ({ operation, gamma, hex }) => {
        // ImageMagick 7.1.2-35 Q16-HDRI: negative, positive, and over-range samples.
        const input = Buffer.from("50660a3320320a312e300abe8000003e0000003fc000003dcccccd3f00068e3f7ff972", "hex");
        const files = new Map<string, Uint8Array>([["/in.pfm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", input);
        const args = ["/in.pfm", operation, gamma, "/out.pfm"];
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
            // Allow float32 rounding in positive integer-power control samples.
            expect(view.getFloat32(header.length + i * 4)).toBeCloseTo(reference.getFloat32(i * 4), 7);
        }
    });
}
