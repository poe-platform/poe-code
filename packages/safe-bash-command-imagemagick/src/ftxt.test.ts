import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const color = sharp(Uint8Array.of(255, 0, 0, 255, 30, 40, 50, 128, 70, 80, 90, 0), { raw: { width: 3, height: 1, channels: 4 } }).png().toBufferSync();
const gray = new TextEncoder().encode("P2\n3 1\n65535\n4660 4661 65535\n");
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        { input: color, options: [], target: "ftxt:/out.dat", expected: "0,0:65535,0,0,65535\n1,0:7710,10280,12850,32896\n2,0:17990,20560,23130,0\n" },
        { input: color, options: ["-define", "ftxt:format=\\x/\\y=\\c\\n"], target: "ftxt:/out.dat", expected: "0/0=65535,0,0,65535\n1/0=7710,10280,12850,32896\n2/0=17990,20560,23130,0\n" },
        { input: gray, options: [], target: "ftxt:-", expected: "0,0:4660\n1,0:4661\n2,0:65535\n" },
        { input: gray, options: ["-define", "ftxt:format=\\c", "+define", "ftxt:format"], target: "ftxt:/out.dat", expected: "0,0:4660\n1,0:4661\n2,0:65535\n" },
        { input: gray, options: ["-define", "ftxt:format=\\c"], target: "/out.ftxt", expected: "4660466165535" }
    ])(`writes FTXT (${mode}): $target $options`, async ({ input, options, target, expected }) => {
        const files = new Map([["/in", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", input);
        const args = ["/in", ...options, target];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        if (target === "ftxt:-") expect(result.stdout).toBe(expected);
        else {
            const path = target.startsWith("ftxt:") ? target.slice(5) : target;
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path);
            expect(bytes).toBeDefined();
            expect(new TextDecoder().decode(bytes)).toBe(expected);
            expect(files.has(`ftxt:${path}`)).toBe(false);
        }
    });
}
