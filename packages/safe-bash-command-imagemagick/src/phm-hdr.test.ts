import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const output of ["info:", "pfm:-", "phm:-"]) {
        it(`preserves PHM extended-range samples (${mode}, ${output})`, async () => {
            // ImageMagick 7.1.2-35 Q16-HDRI: -0.25, 0.125, 1.5.
            const input = Buffer.from("50680a3320310a312e300ab40030003e00", "hex");
            const files = new Map<string, Uint8Array>([["/in.pfm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pfm", input);
            const args = ["/in.pfm", ...(output === "info:" ? ["-format", "%[fx:p{0,0}.r],%[fx:p{1,0}.r],%[fx:p{2,0}.r]"] : []), output];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            if (output === "info:") expect(result.stdout).toBe("-0.25,0.125,1.5");
            else expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(output === "pfm:-"
                ? "50660a3320310a312e300abe8000003e0000003fc00000"
                : input.toString("hex"));
        });
    }
}
