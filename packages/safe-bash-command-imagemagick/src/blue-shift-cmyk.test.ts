import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes; CMYK black and alpha stay unchanged.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "CMYK round trip", operations: ["-colorspace", "CMYK", "-colorspace", "sRGB"], format: "rgba", expected: "4080a080" },
        { name: "original inks", operations: ["-colorspace", "CMYK"], format: "cmyka", expected: "9933005f80" },
        { name: "shifted CMYK round trip", operations: ["-colorspace", "CMYK", "-blue-shift", "1.5", "-colorspace", "sRGB"], format: "rgba", expected: "40505880" },
        { name: "shifted inks", operations: ["-colorspace", "CMYK", "-blue-shift", "1.5"], format: "cmyka", expected: "9980735f80" },
        { name: "sRGB shift", operations: ["-colorspace", "sRGB", "-blue-shift", "1.5", "-colorspace", "sRGB"], format: "rgba", expected: "a0b0b880" },
    ])(`${mode}: blue-shift preserves working samples for $name`, async ({ operations, format, expected }) => {
        const argv = ["xc:#4080a080", ...operations, "-depth", "8", `${format}:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
