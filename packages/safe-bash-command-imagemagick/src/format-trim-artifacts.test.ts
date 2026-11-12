import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const image = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", "rectangle 2,1 4,2"];
const bounds = "3x2+2+1;2,1 5,3\n";
const northBounds = "8x5+0+1;0,1 8,6\n";
const speck = ["-fill", "#eeeeee", "-draw", "point 1,3"];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const output of ["final", "write"] as const) {
        it.each([
            { name: "edges artifact", inputs: [...image, "-set", "artifact:trim:edges", "north"], expected: northBounds },
            { name: "per-image edges", inputs: ["-respect-parentheses", "(", ...image, "-set", "artifact:trim:edges", "north", ")", "(", ...image, ")"], expected: northBounds + bounds },
            { name: "percentage artifact", inputs: [...image, ...speck, "-set", "artifact:trim:percent-background", "50"], expected: bounds },
            { name: "per-image percentage", inputs: ["-respect-parentheses", "(", ...image, ...speck, "-set", "artifact:trim:percent-background", "50", ")", "(", ...image, ...speck, ")"], expected: bounds + "4x3+1+1;1,1 5,4\n" },
            { name: "background artifact overrides define", inputs: [...image, ...speck, "-define", "trim:percent-background=50", "-define", "trim:background-color=black", "-set", "artifact:trim:background-color", "white"], expected: bounds },
            { name: "artifact in property expansion", inputs: [...image, "-set", "artifact:trim:edges", "north", "-set", "bounds", "%@;%[bounding-box]\\n"], format: "%[bounds]", expected: northBounds },
            { name: "define", inputs: [...image, "-define", "trim:edges=north"], expected: northBounds },
            { name: "plain property", inputs: [...image, "-set", "trim:edges", "north"], expected: bounds },
            { name: "removed artifact", inputs: [...image, "-set", "artifact:trim:edges", "north", "+set", "artifact:trim:edges"], expected: bounds },
            { name: "artifact overrides define", inputs: [...image, "-define", "trim:edges=east", "-set", "artifact:trim:edges", "north"], expected: northBounds },
            { name: "raster trim", inputs: [...image, "-set", "artifact:trim:edges", "north", "-trim"], format: "%wx%h%O", expected: "7x4+0+1" }
        ])(`${mode} ${output}: $name`, async ({ inputs, expected, format }) => {
            const template = format ?? "%@;%[bounding-box]\\n";
            const args = [...inputs, "-format", template,
                ...(output === "write" ? ["-write", "info:", "null:"] : ["info:"])];
            const filesystem = new MemoryFileSystem();
            let result;
            if (mode === "command") {
                const argumentValues = createCommandArguments(args);
                let stdout = "", stderr = "";
                const status = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                result = { ...status, stdout, stderr };
            } else result = mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        });
    }
}
