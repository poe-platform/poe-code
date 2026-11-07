import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["ftxt:/rgb.dat", "ftxt:-"])(`decodes Q16 FTXT pixels via ${mode}: %s`, async operand => {
        const bytes = new TextEncoder().encode("0,0:65535,0,0\n1,0:0,32768,65535\n");
        const files = new Map([["/rgb.dat", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/rgb.dat", bytes);
        const args = ["-size", "2x1", operand, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files, bytes) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, bytes);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([2, 1]);
        expect(Array.from(image.data)).toEqual([255, 0, 0, 255, 0, 128, 255, 255]);
        expect(Array.from(image.data16!)).toEqual([65535, 0, 0, 65535, 0, 32768, 65535, 65535]);
    });
}

for (const retained of [false, true]) {
    it(`reads FTXT across chunk boundaries (${retained})`, async () => {
        const width = 2000;
        const bytes = new TextEncoder().encode(Array.from({ length: width }, (_, x) => `${x},0:${x},32768,65535`).join("\n"));
        const files = new Map([["/in", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", bytes);
        const result = await runConvertCli(["-size", `${width}x1`, "ftxt:/in", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(image.data16!)).toEqual(Array.from({ length: width }, (_, x) => [x, 32768, 65535, 65535]).flat());
    });

    it.each([
        { size: [], text: "0,0:65535,0,0\n", error: "must specify image size" },
        { size: ["-size", "2x1"], text: "0,0:65535,0,0\n", error: "truncated FTXT" },
        { size: ["-size", "1x1"], text: "0,0:65536,0,0\n", error: "invalid FTXT pixel" },
        { size: ["-size", "1x1"], text: "0,0:0,,0\n", error: "invalid FTXT pixel" },
        { size: ["-size", "1x1"], text: "1,0:65535,0,0\n", error: "invalid FTXT pixel" }
    ])(`preserves output on invalid FTXT (${retained}): $error`, async ({ size, text, error }) => {
        const bytes = new TextEncoder().encode(text), original = Uint8Array.of(42);
        const files = new Map([["/in", bytes], ["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", bytes);
        await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli([...size, "ftxt:/in", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(error);
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}
