import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Captured with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { terms: "0,1,1,1", second: [], output: ["+channel", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], expected: "337fbf" },
        { terms: "0,1,1,1", second: [], output: ["-format", "%[colorspace]", "info:/out"], expected: "CMYK" },
        { terms: "1,1", second: [], output: ["+channel", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], expected: "336699" },
        { terms: "0,1,1,1", second: ["-colorspace", "CMYK"], output: ["+channel", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], expected: "cc8040" },
    ])(`${mode}: accumulates mixed CMYK/sRGB sources for $terms, $second and $output`, async ({ terms, second, output, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        let stderr = "";
        const args = ["(", "xc:#336699", "-colorspace", "CMYK", ")",
            "(", "xc:#cc8040", ...second, ")", "-poly", terms, ...output];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "sync" || mode === "map" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(bytes).toString(output[0] === "-format" ? "utf8" : "hex")).toBe(expected);
    });
}
