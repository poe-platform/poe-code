import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#234567 [-depth 8|16] txt:-.
const low = "# ImageMagick pixel enumeration: 1,1,0,255,srgb\n0,0: (35,69,103)  #234567  srgb(35,69,103)\n";
const high = "# ImageMagick pixel enumeration: 1,1,0,65535,srgb\n0,0: (8995,17733,26471)  #232345456767  srgb(35,69,103)\n";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["txt:-", "txt:/out.txt"])(`${mode} sRGB TXT uses image depth and honors explicit depth (%s)`, async output => {
        for (const source of ["xc:#234567", "ppm8", "ppm16"]) {
            for (const depth of [undefined, 8, 16]) {
                const sourceDepth = source === "ppm8" ? 8 : 16;
                const header = new TextEncoder().encode(`P6\n1 1\n${sourceDepth === 8 ? 255 : 65535}\n`);
                const bytes = Uint8Array.from([...header, ...[35, 69, 103].flatMap(value => sourceDepth === 8 ? [value] : [value, value])]);
                const files = new Map([["/in.ppm", bytes]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", bytes);
                const args = [source.startsWith("xc:") ? source : "/in.ppm", ...(depth === undefined ? [] : ["-depth", String(depth)]), output];
                let stdout = "", stderr = "";
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : mode === "buffered" ? await runConvertCli(args, files)
                    : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" })
                    : await createMagickCommand().execute({
                        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
                        stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
                    });
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const text = output === "txt:-"
                    ? "stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout
                    : new TextDecoder().decode(mode === "command" || mode === "retained" ? await fs.readFile("/out.txt") : files.get("/out.txt"));
                expect(text, `${source}, depth=${depth}`).toBe((depth ?? sourceDepth) > 8 ? high : low);
            }
        }
    });
}
