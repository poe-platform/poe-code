import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operation of [["-normalize"], ["-contrast-stretch", "0%x0%"], ["-contrast-stretch", "1x1"]]) {
        it.each(["gray", "red", "constant"])(`${mode}: ${operation.join(" ")} preserves 16-bit %s samples`, async kind => {
            // Native ImageMagick Q16 results for the reported gray and tone images.
            const samples = kind === "red"
                ? [5001, 5021, 5041, 5081].flatMap(value => [value, value + 12200, value + 21300, 65535])
                : (kind === "constant" ? [10016, 10016, 10016, 10016] : [10000, 10016, 10032, 10048])
                    .flatMap(value => [value, value, value, 65535]);
            const stretched = operation[1] === "1x1" ? [0, 0, 65535, 65535]
                : kind === "red" ? [0, 16384, 32768, 65535] : [0, 21845, 43690, 65535];
            const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb", channels: 3,
                depth: "ushort", density: 72, hasAlpha: false
            }, { format: "png" }).data;
            const files = new Map([["/in.png", input]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", ...(kind === "red" ? ["-channel", "R"] : []), ...operation, "+channel", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            const decoded = decodeImage(output);
            const actual = decoded.data16 ?? Uint16Array.from(decoded.data, value => value * 257);
            expect([...actual]).toEqual(samples.map((value, index) =>
                kind !== "constant" && (kind === "red" ? index % 4 === 0 : index % 4 < 3)
                    ? stretched[Math.floor(index / 4)]! : value));
        });
    }
}
