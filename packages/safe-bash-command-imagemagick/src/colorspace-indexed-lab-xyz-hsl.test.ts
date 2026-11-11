import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Four-bit PNG with duplicate red entries, unused colors, and non-palette raster order.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADBAMAAABG2rP1AAAAMFBMVEX/AAAA/wAAAP//AABkMhQAZJb///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC7dSOKAAAAEUlEQVR4nGNwZGUwD2dQdgQABSoBOc0JSuMAAAAASUVORK5CYII=", "base64");
// Native ImageMagick 7.1.2-35 Q16-HDRI reference results.
const directCycle = "ff0000ff006496ff00ff00ff0000ffff00ff00ff643214ff0000ffff643214ff000000ff00ff00ffff0000ff006496ff";
const cases = [
    { space: "Lab", info: "DirectClass CIELab |cielab  3.0", cycle: directCycle },
    { space: "XYZ", info: "DirectClass XYZ |xyz  3.0", cycle: directCycle },
    { space: "HSL", info: "DirectClass HSL |hsl  3.0", cycle: directCycle },
    { space: "sRGB", info: "PseudoClass sRGB |srgb  4.0", cycle: "006496ff0000ffff00ff00ffffffffff643214ff000000ffffffffff000000ffff0000ff643214ff006496ff0000ffff" },
    { space: "CMYK", info: "DirectClass CMYK |cmyk  4.0", cycle: directCycle },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const outputKind of ["metadata", "cycle pixels", "cycle metadata"] as const) {
        it.each(cases)(`${mode}: indexed $space ${outputKind}`, async ({ space, info, cycle: pixels }) => {
            const cycle = outputKind !== "metadata", raw = outputKind === "cycle pixels";
            const args = ["pal.png", "-colorspace", space, "-colorspace", space, ...(cycle ? ["-cycle", "1"] : []), ...(raw
                ? ["-colorspace", "sRGB", "-depth", "8", "rgba:out"]
                : ["-format", "%r|%[channels]", "info:out"])];
            const files = new Map<string, Uint8Array>([["pal.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/pal.png", input);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
            expect(Buffer.from(output).toString(raw ? "hex" : "utf8")).toBe(raw ? pixels : cycle ? "PseudoClass sRGB |srgb  4.0" : info);
        });
    }
}
