import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: color-only composition leaves the canvas Meta0 at zero.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const output of ["meta", "rgba"] as const) {
        it.each([
            { compose: "CopyRed", pixel: "408abc80" },
            { compose: "Luminize", pixel: "3e82b480" },
            { compose: "DarkenIntensity", pixel: "00000000" },
            { compose: "LightenIntensity", pixel: "468abc00" },
            { compose: "Modulate", pixel: "3c7aa780" },
            { compose: "CopyGreen", pixel: "467fbc80" },
            { compose: "CopyBlue", pixel: "468abf80" },
            { compose: "Colorize", pixel: "4887c780" },
            { compose: "Hue", pixel: "4c86c280" },
            { compose: "Saturate", pixel: "428bc180" },
            { compose: "Over", pixel: "4283bebf", meta: "000000000000000000a9a90000000000" },
            { compose: "Copy", pixel: "407fbf7f", meta: "000000000000000000ffff0000000000" },
        ])(`${mode}: extent $compose preserves ${output}`, async ({ compose, pixel, meta }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "2x2", "xc:gray25", "xc:gray50", "xc:gray75", "xc:gray50",
                "gradient:black-white", "-combine", "-background", "#468abc80", "-compose", compose,
                ...(compose === "Modulate" ? ["-define", "compose:args=80x90"] : []), "-extent", "4x4-1-1",
                ...(output === "meta" ? ["-channel", "Meta0", "-separate", "+channel"] : []),
                "-depth", "8", output === "meta" ? "gray:-" : "rgba:-"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stderr: "" });
            const padding = "468abc80";
            const expected = output === "meta" ? meta ?? "00".repeat(16)
                : padding.repeat(4) + (padding + pixel.repeat(2) + padding).repeat(2) + padding.repeat(4);
            expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
                ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
        });
    }
}
