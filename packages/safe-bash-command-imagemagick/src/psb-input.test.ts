import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "../../../tests/fixtures/media/psb-input-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35: magick -size 4x4 xc:red xc:blue +append -depth 8 -compress None/RLE in.psb/psd
// Native reads both spellings as an 8x4 composite and layer, each with four red then four blue pixels per row.
const pixels = ("ff0000".repeat(4) + "0000ff".repeat(4)).repeat(4);
for (const format of ["psb", "psd"] as const) for (const compression of ["none", "rle"] as const) {
    for (const prefix of ["", `${format}:`]) for (const selector of ["", "[0]", "[1]"]) {
        for (const mode of ["sync", "buffered", "command"] as const) {
            it(`reads native ${format} ${compression} ${prefix || "unprefixed"}${selector} (${mode})`, async () => {
                const fixture = Buffer.from(fixtures[`${format}_${compression}`], "base64");
                const path = `/in.${format}`;
                const files = new Map([[path, fixture]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile(path, fixture);
                const argv = [`${prefix}${path}${selector}`, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
                const args = createCommandArguments(argv);
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
                expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : undefined).toBe("");
                expect(result.exitCode).toBe(0);
                const output = mode === "command" ? Buffer.concat(chunks) : Buffer.from(files.get("/out")!);
                expect(output.toString("hex")).toBe(pixels.repeat(selector ? 1 : 2));
            });
        }
    }
}
