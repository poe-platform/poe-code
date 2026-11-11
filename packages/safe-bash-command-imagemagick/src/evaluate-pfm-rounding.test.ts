import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: compare packed float32 samples, including HDR values.
const input = "be8000003e0000003fc000003dcccccd3f00068e3f7ff972";
const added = "be4ccc9a3e3333663fc6666c3e1999cd3f0cd3683f866325";

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const color of [false, true]) {
        it.each([
            { name: "unchanged", operations: [], expected: input },
            { name: "percentage addition", operations: ["-evaluate", "Add", "5%"], expected: added },
            { name: "percentage sum alias", operations: ["-evaluate", "Sum", "5%"], expected: added },
            { name: "quantum addition", operations: ["-evaluate", "Add", "3276.8"], expected: added },
        ])(`${mode}, color=${color}: preserves float32 rounding for $name`, async ({ operations, expected }) => {
            const header = Buffer.from(color ? "PF\n1 2\n1.0\n" : "Pf\n3 2\n1.0\n");
            const bytes = new Uint8Array(Buffer.concat([header, Buffer.from(input, "hex")]));
            const files = new Map([["/in.pfm", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pfm", bytes);
            const args = ["/in.pfm", ...operations, "/out.pfm"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
            expect(Buffer.from(output).toString("hex")).toBe(header.toString("hex") + expected);
        });
    }
}
