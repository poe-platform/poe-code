import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "RGB control", args: ["xc:red"], expected: "65535,0,0" },
        { name: "CMYK", args: ["xc:red", "-colorspace", "CMYK"], expected: "0,65535,65535,0" },
        { name: "CMYK with alpha", args: ["xc:red", "-colorspace", "CMYK", "-alpha", "set"], expected: "0,65535,65535,0,65535" },
        { name: "disabled alpha", args: ["xc:red", "-colorspace", "CMYK", "-alpha", "set", "-alpha", "off"], expected: "0,65535,65535,0" },
        { name: "black ink", args: ["xc:black", "-colorspace", "CMYK"], expected: "0,0,0,65535" },
        { name: "independent black and alpha", args: ["xc:cmyka(0,255,255,255,0)"], expected: "0,65535,65535,65535,0" },
    ])(`writes FTXT channels (${mode}): $name`, async ({ args, expected }) => {
        const fs = new MemoryFileSystem();
        const argv = [...args, "ftxt:-"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argv, new Map())
            : mode === "buffered" ? await runConvertCli(argv, new Map())
            : mode === "retained" ? await runConvertCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            });
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(`0,0:${expected}\n`);
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`writes CMYK file rows across storage chunks (${mode})`, async () => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "1x4097", "xc:cmyka(255,0,255,255,0)", "-define", "ftxt:format=\\x/\\y=\\c\\n", "ftxt:/out.dat"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
        const bytes = mode === "retained" ? await fs.readFile("/out.dat") : files.get("/out.dat");
        expect(new TextDecoder().decode(bytes)).toBe(Array.from({ length: 4097 }, (_, y) => `0/${y}=65535,0,65535,65535,0\n`).join(""));
    });
}
