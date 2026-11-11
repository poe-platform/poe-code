import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference results.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { input: "gradient:red-blue", size: "3x2", extract: "2x1+1+1", geometry: "2x1", hex: "3612" },
        { input: "gradient:red-blue", size: "3x2", extract: "2x1", geometry: "2x1", hex: "3612" },
        { input: "gradient:red-blue[2x1+1+1]", size: "3x2", geometry: "2x1", hex: "3612" },
        { input: "radial-gradient:red-blue", size: "3x2", extract: "2x1+1+1", geometry: "2x1", hex: "1212" },
        { input: "xc:red", size: "3x2", extract: "1x1+9+9", geometry: "1x1", hex: "36" },
        { input: "canvas:red", size: "3x2", extract: "1x1+9+9", geometry: "1x1", hex: "36" },
        { input: "gradient:red-blue", size: "2x1", geometry: "2x1", hex: "3612" },
        { input: "xc:red", size: "2x1", geometry: "2x1", hex: "3636" },
    ])(`${mode} generates $input with extraction $extract`, async ({ input, size, extract, geometry, hex }) => {
        const files = new Map<string, Uint8Array>([["/out.raw", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.raw", files.get("/out.raw")!);
        const argv = ["-size", size, ...(extract ? ["-extract", extract] : []), input,
            "-format", "%wx%h|%g", "-write", "info:", "-depth", "8", "gray:/out.raw"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(`${geometry}|${geometry}+0+0`);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
