import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

const cases = [
    { name: "CMYK", input: ["xc:cmyk(10%,20%,30%,40%)"], hex: "2f9a" },
    { name: "HSL", input: ["xc:#4682b4", "-colorspace", "HSL"], hex: "78f5" },
    { name: "Lab", input: ["xc:#4682b4", "-colorspace", "Lab"], hex: "7c16" },
    { name: "XYZ", input: ["xc:#4682b4", "-colorspace", "XYZ"], hex: "3861" },
    { name: "sRGB", input: ["xc:#4682b4"], hex: "7952" },
    { name: "linear RGB", input: ["xc:#4682b4", "-colorspace", "RGB"], hex: "34a3" },
    { name: "HSL converted to sRGB", input: ["xc:#4682b4", "-colorspace", "HSL", "-colorspace", "sRGB"], hex: "7952" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const depth of [4, 16]) for (const ascii of [false, true]) {
        it.each(cases)(`${mode}: writes $name working intensity at depth ${depth}, ascii=${ascii}`, async ({ input, hex }) => {
            const args = [...input, "-depth", String(depth), ...(ascii ? ["-compress", "none"] : []), "pgm:-"];
            const native = spawnSync("magick", args);
            expect(native.status).toBe(0);
            if (depth === 16 && !ascii) expect(native.stdout.subarray(-2).toString("hex")).toBe(hex);
            const fs = new MemoryFileSystem();
            let output: Uint8Array;
            if (mode === "command") {
                const values = createCommandArguments(args), chunks: Uint8Array[] = [];
                let stderr = "";
                const result = await createMagickCommand().execute({ command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
                expect(stderr).toBe("");
                expect(result.exitCode).toBe(0);
                output = Buffer.concat(chunks);
            } else {
                const result = mode === "sync" ? runMagickCliSync(args, new Map())
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
                expect(result.stderr).toBe("");
                expect(result.exitCode).toBe(0);
                output = result.stdoutBytes!;
            }
            if (ascii) expect(Buffer.from(output).toString().trim().split(/\s+/)).toEqual(native.stdout.toString().trim().split(/\s+/));
            else expect(Buffer.from(output)).toEqual(native.stdout);
        });
    }
}

it.each(["buffered", "retained", "sync"] as const)("%s: handles adjoined PGM frames and leaves working channels unchanged after -write", async mode => {
    const input = ["xc:cmyk(10%,20%,30%,40%)", "(", "xc:#4682b4", "-colorspace", "HSL", ")", "-depth", "16"];
    const info = ["-format", "%[colorspace] %[pixel:p{0,0}]\\n", "info:"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const run = (tokens: string[]) => mode === "sync" ? runMagickCliSync(tokens, files)
        : runConvertCli(tokens, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const before = await run([...input, ...info]);
    const after = await run([...input, "-write", "out.pgm", ...info]);
    expect(before.exitCode).toBe(0);
    expect(after.stderr).toBe("");
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toBe(before.stdout);
    const native = spawnSync("magick", [...input, "pgm:-"]);
    expect(native.status).toBe(0);
    expect(Buffer.from(mode === "retained" ? await fs.readFile("/out.pgm") : files.get("out.pgm")!)).toEqual(native.stdout);
});
