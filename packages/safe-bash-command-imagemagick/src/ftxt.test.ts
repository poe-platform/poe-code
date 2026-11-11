import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const color = sharp(Uint8Array.of(255, 0, 0, 255, 30, 40, 50, 128, 70, 80, 90, 0), { raw: { width: 3, height: 1, channels: 4 } }).png().toBufferSync();
const rgb = Uint8Array.from([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
const gray = new TextEncoder().encode("P2\n3 1\n65535\n4660 4661 65535\n");
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { input: rgb, options: ["-colorspace", "Gray", "-precision", "3"], target: "ftxt:-", expected: "0,0:4.78e+03\n1,0:2.75e+04\n" },
        { input: rgb, options: ["-colorspace", "Gray", "-precision", "12"], target: "ftxt:/out.dat", expected: "0,0:4778.9921875\n1,0:27547.984375\n" },
        { input: rgb, options: ["-colorspace", "Gray"], target: "ftxt:-", expected: "0,0:4778.99\n1,0:27548\n" },
        { input: rgb, options: [], target: "ftxt:-", expected: "0,0:2570,5140,7710\n1,0:23130,28270,33410\n" },
        { input: color, options: [], target: "ftxt:/out.dat", expected: "0,0:65535,0,0,65535\n1,0:7710,10280,12850,32896\n2,0:17990,20560,23130,0\n" },
        { input: color, options: ["-define", "ftxt:format=\\x/\\y=\\c\\n"], target: "ftxt:/out.dat", expected: "0/0=65535,0,0,65535\n1/0=7710,10280,12850,32896\n2/0=17990,20560,23130,0\n" },
        { input: gray, options: [], target: "ftxt:-", expected: "0,0:4660\n1,0:4661\n2,0:65535\n" },
        { input: gray, options: ["-define", "ftxt:format=\\c", "+define", "ftxt:format"], target: "ftxt:/out.dat", expected: "0,0:4660\n1,0:4661\n2,0:65535\n" },
        { input: gray, options: ["-define", "ftxt:format=\\c"], target: "/out.ftxt", expected: "4660466165535" }
    ])(`writes FTXT (${mode}): $target $options`, async ({ input, options, target, expected }) => {
        const files = new Map([["/in", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", input);
        const args = ["/in", ...options, target];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        if (target === "ftxt:-") expect(result.stdout).toBe(expected);
        else {
            const path = target.startsWith("ftxt:") ? target.slice(5) : target;
            const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile(path) : files.get(path);
            expect(bytes).toBeDefined();
            expect(new TextDecoder().decode(bytes)).toBe(expected);
            expect(files.has(`ftxt:${path}`)).toBe(false);
        }
    });
}
