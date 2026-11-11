import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3420320a3235350aff000000ff000000ffffffff000000ff8000fe0180804080", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI, identical PPM bytes and arguments.
const cases = [
    { name: "default 2x2", options: [], coder: "yuv", hex: "4c961dff00975b5a5c989b97" },
    { name: "explicit 2x2", options: ["-sampling-factor", "2x2"], coder: "yuv", hex: "4c961dff00975b5a5c989b97" },
    { name: "packed 2x1", options: ["-sampling-factor", "2x1"], coder: "yuv", hex: "5b4c8596aa1d67ff5e00b097855bc75a" },
    { name: "reset sampling", options: ["-sampling-factor", "2x1", "+sampling-factor"], coder: "yuv", hex: "4c961dff00975b5a5c989b97" },
    { name: "planar 2x1", options: ["-sampling-factor", "2x1", "-interlace", "plane"], coder: "yuv", hex: "4c961dff00975b5a5baa5e858567b0c7" },
    { name: "odd dimensions", options: ["-crop", "3x1+0+0", "+repage"], coder: "yuv", hex: "4c7a681d4c7a681d45b0a74b" },
    { name: "16-bit planes", options: ["-depth", "16", "-endian", "MSB"], coder: "yuv", hex: "4c8096391d46ffff000097e85b7c5acc5cd498489b3497f0" },
    { name: "16-bit packed", options: ["-sampling-factor", "2x1", "-depth", "16", "-endian", "LSB"], coder: "yuv", hex: "5b4c80859639aa1d4667ffff5e0000b097e8855b7cc75acc" },
    { name: "RGB control", options: [], coder: "rgb", hex: "ff000000ff000000ffffffff000000ff8000fe0180804080" },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode} writes $name to stdout without creating a file`, async ({ options, coder, hex }) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-depth", "8", ...options, `${coder}:-`];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "retained" ? await runMagickCli(args, { filesystem: fs, cwd: "/" })
            : mode === "buffered" ? await runMagickCli(args, files) : runMagickCliSync(args, files);
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) chunks.push(result.stdoutBytes);
        if ("stderr" in result) stderr = result.stderr as string;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
        expect([...files.keys()]).toEqual(["/in.ppm"]);
        expect(await fs.readdir("/")).toEqual([{ name: "in.ppm", type: "file" }]);
    });
}

for (const retained of [false, true]) {
    it(`recognizes YUV extensions and coder overrides in intermediate writes, retained=${retained}`, async () => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = await runMagickCli(["/in.ppm", "-sampling-factor", "2x1", "-depth", "8", "-write", "YUV:/out.png", "+write", "/out.yuv", "rgb:-"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(cases[cases.length - 1]!.hex);
        for (const path of ["/out.png", "/out.yuv"]) {
            expect(Buffer.from(retained ? await filesystem.readFile(path) : files.get(path)!).toString("hex")).toBe(cases[2]!.hex);
        }
    });
    it(`rejects unsupported sampling without replacing the destination, retained=${retained}`, async () => {
        const files = new Map([["/in.ppm", input], ["/out.yuv", Buffer.from("KEEP")]]), filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const result = runMagickCli(["/in.ppm", "-sampling-factor", "4x2", "/out.yuv"], retained ? { filesystem, cwd: "/" } : files);
        if (retained) await expect(result).rejects.toThrow("sampling factor");
        else {
            const failure = await result;
            expect(failure.exitCode).not.toBe(0);
            expect(failure.stderr).toContain("sampling factor");
        }
        expect(Buffer.from(retained ? await filesystem.readFile("/out.yuv") : files.get("/out.yuv")!).toString()).toBe("KEEP");
    });
}
