import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`matches native Q16-HDRI level float32 samples (${mode})`, async () => {
        const input = Buffer.from("50660a3320320a312e300abe8000003e0000003fc000003dcccccd3f00068e3f7ff972", "hex");
        const files = new Map([["/in.pfm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", input);
        const argv = ["/in.pfm", "-level", "10%,90%", "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
        // ImageMagick 7.1.2-35 Q16-HDRI: compare stored floats, not an 8-bit preview.
        expect(Buffer.from(output).toString("hex")).toBe("50660a3320320a312e300a000000003d0000003f800000000000003f0008323f800000");
    });
}
