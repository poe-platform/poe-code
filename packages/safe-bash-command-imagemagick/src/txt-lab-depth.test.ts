import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PPM 208040ff2200 converted to Lab.
const low = "0,0: (120,85,154)  #78559A  cielab(47.1249,-42.1867,26.9476)";
const high = "0,0: (30883,21926,39693)  #78A355A69B0D  cielab(47.1249,-42.1867,26.9476)";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([8, 16])(`${mode} Lab TXT uses source depth %s and honors explicit depth`, async sourceDepth => {
        for (const depth of [undefined, 8, 16]) {
            for (const output of ["txt:-", "txt:/out.txt"]) {
                const header = new TextEncoder().encode(`P6\n2 1\n${sourceDepth === 8 ? 255 : 65535}\n`);
                const samples = [32, 128, 64, 255, 34, 0];
                const input = Uint8Array.from([...header, ...samples.flatMap(value => sourceDepth === 8 ? [value] : [value, value])]);
                const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const args = ["/in.ppm", "-colorspace", "Lab", ...(depth === undefined ? [] : ["-depth", String(depth)]), output];
                let stdout = "", stderr = "";
                const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" }) : await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                    stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                });
                expect(result.exitCode, stderr).toBe(0);
                const text = output === "txt:-"
                    ? "stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout
                    : new TextDecoder().decode(mode === "command" || mode === "retained" ? await fs.readFile("/out.txt") : files.get("/out.txt"));
                const highDepth = (depth ?? sourceDepth) > 8;
                const lines = text.split("\n");
                expect(lines[0]).toBe(`# ImageMagick pixel enumeration: 2,1,0,${highDepth ? 65535 : 255},cielab`);
                expect(lines[1]?.split("  cielab")[0]).toBe((highDepth ? high : low).split("  cielab")[0]);
                if (depth === undefined) {
                    expect(lines[1]).toBe(highDepth ? high : low);
                    expect(lines[2]).toBe(highDepth
                        ? "1,0: (35685,52453,50156)  #8B65CCE5C3EC  cielab(54.4516,76.5968,67.6603)"
                        : "1,0: (139,204,195)  #8BCCC3  cielab(54.4516,76.5968,67.6603)");
                }
            }
        }
    });
}
