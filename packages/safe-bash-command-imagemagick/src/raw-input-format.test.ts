import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick reports the selected raw coder, not its decoding container.
const coders = [
    ["rgb", 3], ["rgba", 4], ["rgbo", 4], ["bgr", 3], ["bgra", 4], ["bgro", 4],
    ["gray", 1], ["graya", 2], ["cmyk", 4], ["cmyka", 5]
] as const;

for (const mode of ["command", "stream", "buffered", "sync"] as const) {
    it.each(coders)(`${mode} reports %s input coder in both format properties`, async (coder, channels) => {
        const bytes = new Uint8Array(channels).fill(0x7b);
        const argv = ["-size", "1x1", "-depth", "8", `${coder}:${mode === "stream" ? "-" : "/in.bin"}`, "-format", "%m|%[magick]", "info:"];
        const files = new Map([["/in.bin", bytes]]);
        let result;
        if (mode === "buffered" || mode === "sync") {
            result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.bin", bytes);
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        }
        expect(result).toMatchObject({ exitCode: 0, stdout: `${coder.toUpperCase()}|${coder.toUpperCase()}`, stderr: "" });
    });
}

for (const mode of ["retained", "buffered", "sync"] as const) {
    it.each(coders)(`${mode} retains %s extension coder across frames and pixel operations`, async (coder, channels) => {
        const fs = new MemoryFileSystem();
        const path = `/in.${coder.toUpperCase()}`;
        const bytes = new Uint8Array(channels * 2).fill(0x7b);
        await fs.writeFile(path, bytes);
        const files = new Map([[path, bytes]]);
        const argv = ["-size", "1x1", "-depth", "8", path, "-flop", "-format", "%m|%[magick]\n", "info:"];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: `${coder.toUpperCase()}|${coder.toUpperCase()}\n`.repeat(2), stderr: "" });
    });

    it(`${mode} preserves raw gray pixels when reporting the coder`, async () => {
        const fs = new MemoryFileSystem();
        const bytes = Uint8Array.of(0x40, 0xc0);
        await fs.writeFile("/in.bin", bytes);
        const files = new Map([["/in.bin", bytes]]);
        const argv = ["-size", "2x1", "-depth", "8", "gray:/in.bin", "-format", "%m|%[magick]", "-write", "info:", "rgba:/out"];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "GRAY|GRAY", stderr: "" });
        expect(Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe("404040ffc0c0c0ff");
    });
}
