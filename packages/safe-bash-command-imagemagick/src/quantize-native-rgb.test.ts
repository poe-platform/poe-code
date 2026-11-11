import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: average the palette in its working RGB space.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    for (const [space, pixel] of [["DisplayP3", "966a66ff"], ["Adobe98", "9e6365ff"], ["ProPhoto", "9f7165ff"], ["sRGB", "886464ff"]]) {
        for (const output of ["info", "rgba"]) {
            it(`quantizes ${space} working samples for ${output} output (${mode})`, async () => {
                const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argv = ["xc:#34a05c", "xc:#dc276c", "+append", "-colorspace", space!, "+dither", "-colors", "1",
                    ...(output === "info" ? ["-format", "%[colorspace]"] : ["-colorspace", "sRGB", "-depth", "8"]), `${output}:/out`];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "public" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const bytes = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(output === "info" ? space : pixel!.repeat(2));
            });
        }
    }
}
