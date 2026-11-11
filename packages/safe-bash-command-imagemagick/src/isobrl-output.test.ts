import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the PBM control confirms the input raster.
const input = Buffer.from("P1\n3 5\n1 0 0\n0 1 0\n0 0 1\n1 0 0\n0 1 1\n");
const cases = [
    { output: "ISOBRL:-", hex: "21040801" },
    { output: "ISOBRL:/out.bin", hex: "21040801", path: "/out.bin", metadata: true },
    { output: "/out.isobrl", hex: "21040801", path: "/out.isobrl" },
    { output: "ISOBRL6:-", hex: "21040100" },
    { output: "ISOBRL6:/out.bin", hex: "21040100", path: "/out.bin", metadata: true },
    { output: "/out.isobrl6", hex: "21040100", path: "/out.isobrl6" },
    { output: "pbm:-", hex: "50340a3320350a8040208060" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const write of [false, true]) {
        it.each(cases)(`writes $output with exact bytes and no extra files (${mode}, write=${write})`, async ({ output, hex, path, metadata }) => {
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["/in.ppm", ...(metadata ? ["-set", "label", "Sample", "-repage", "9x8+1+2"] : []), ...(write ? ["-write", output, "null:"] : [output])];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const arguments_ = createCommandArguments(args);
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            const stdout = Buffer.from(result.stdoutBytes ?? []);
            const retained = mode === "retained" || mode === "command";
            const bytes = path ? retained ? await filesystem.readFile(path) : files.get(path)! : stdout;
            expect(Buffer.from(bytes ?? []).toString("hex")).toBe(hex);
            if (path) expect(stdout.length).toBe(0);
            const filenames = retained ? (await filesystem.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
            expect(filenames.sort()).toEqual(["/in.ppm", ...(path ? [path] : [])].sort());
        });
    }
}

for (const mode of ["sync", "retained"] as const) {
    it.each([
        ["ISOBRL", "8bb4c238dda8e154ff6b9a48558030d7a1a4ccec791c4a505e0e4aff96c7aaa6"],
        ["ISOBRL6", "31d2343a296551da2bd60e6fba3ca8145cf00f211dc893497798510a4293f8c6"]
    ])(`matches native wide-image cells across bounded chunks (${mode}, %s)`, async (format, hash) => {
        const width = 2051, height = 9;
        const pixels = Array.from({ length: width * height }, (_, i) => (i % width * 13 + Math.floor(i / width) * 29) % 17 < 7 ? 1 : 0);
        const input = Buffer.from(`P1\n${width} ${height}\n${pixels.join(" ")}\n`);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pbm", input);
        const args = ["/in.pbm", `${format}:-`];
        const result = mode === "sync" ? runConvertCliSync(args, new Map([["/in.pbm", input]]))
            : await runConvertCli(args, { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdoutBytes?.length).toBe(3078);
        expect(createHash("sha256").update(result.stdoutBytes!).digest("hex")).toBe(hash);
    });
    it.each([
        ["black", "ISOBRL", "ff470901"], ["black", "ISOBRL6", "3f071b03"],
        ["white", "ISOBRL", "00000000"], ["white", "ISOBRL6", "00000000"]
    ])(`preserves high bits and NUL cell bytes (${mode}, %s %s)`, async (color, format, hex) => {
        const args = ["-size", "3x5", `xc:${color}`, `${format}:-`];
        const result = mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(hex);
    });
}
