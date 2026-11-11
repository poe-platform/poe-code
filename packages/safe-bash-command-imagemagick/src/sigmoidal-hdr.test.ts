import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: in.pfm OPTION 3x50% out.pfm.
const input = Buffer.from("50660a3320320a312e300abe8000003e0000003fc000003dcccccd3f00068e3f7ff972", "hex");

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { option: "-sigmoidal-contrast", expected: [-0.137095481, 0.09865322, 1.212548018, 0.077225491, 0.500118077, 0.999929547] },
        { option: "+sigmoidal-contrast", expected: [-0.740321875, 0.15448837, 9.941396713, 0.12653932, 0.500084698, 0.999858022] }
    ])(`${mode}: preserves out-of-range $option samples in PFM`, async ({ option, expected }) => {
        const files = new Map<string, Uint8Array>([["/in.pfm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", input);
        const args = ["/in.pfm", option, "3x50%", "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = Buffer.from(mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!);
        const header = "Pf\n3 2\n1.0\n";
        expect(output.subarray(0, header.length).toString()).toBe(header);
        expect(output.length).toBe(header.length + expected.length * 4);
        expected.forEach((sample, index) => expect(output.readFloatBE(header.length + index * 4)).toBeCloseTo(sample, 7));
    });
}
