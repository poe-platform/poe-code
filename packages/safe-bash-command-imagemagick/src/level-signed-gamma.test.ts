import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for the same PPM input.
const expanded = "00008d74d1750000d782fffff975ffff786d";
const compressed = "1a382b3d538a1a655945aca7826490d4253e";
const negative = "0000ffffffff0000ffffee96fffffd2dffff";
const linear = "00004e29ab620000b56cfffff317ffff38a6";
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["-level", "10x80%+2", expanded],
        ["+level", "10,80%+2", compressed],
        ["-level", "10x80%-2", negative],
        ["-level", "10%,80%,-2", negative],
        ["-level", "10x80%,2", expanded],
        ["+level", "10x80%,2", compressed],
        ["+level", "10x80%+2", compressed],
        ["-level", "10,80%-2", negative],
        ["-level", "10/80%+2", expanded],
        ["-level", "1e+1x8e+1%+2e+0", expanded],
        ["-level", "1e+1x8e+1%-2e+0", negative],
        ["-level", "1e+1x8e+1%,2e+0", expanded],
        ["-level", "1e+1x8e+1%", linear],
        ["-level", "1e+1x800e-1%", linear],
        ["-level", "10x+80%,+2", expanded],
    ])(`${mode} reads the gamma in %s %s`, async (operator, geometry, expected) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const files = new Map([["/a.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const argv = ["/a.ppm", operator, geometry, "-endian", "MSB", "-depth", "16", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command"
            ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
            : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
