import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const red = "ffff00000000ffff", blue = "00000000ffffffff", clear = "0000000000000000";
const base = ["(", "-size", "4x1", "xc:red", "-repage", "4x1+0+0", "-set", "dispose", "None", ")"];
const patch = ["(", "-size", "1x1", "xc:blue", "-repage", "4x1+1+0", "-set", "dispose", "None", ")"];
const erase = ["(", "-size", "1x1", "xc:none", "-repage", "4x1+3+0", "-set", "dispose", "None", ")"];

// Native ImageMagick 7.1.2-35: compare frame rectangles and unencoded Q16 pixels.
const cases = [
    { name: "deconstruct alias", frames: [...base, ...patch, ...base], method: "-deconstruct", geometry: "4x1+0+0;1x1+1+0;1x1+1+0;", pixels: red.repeat(4) + blue + red },
    { name: "omitted clear updates the canvas", frames: [...base, ...erase, ...base], method: "CompareOverlay", geometry: "4x1+0+0;1x1+3+0;", pixels: red.repeat(4) + red },
    { name: "repeat clear is unchanged", frames: [...base, ...patch, ...erase, ...erase], method: "CompareClear", geometry: "4x1+0+0;1x1+3+0;", pixels: red.repeat(4) + clear },
    { name: "vertical page offsets", frames: [...base, ...patch, ...base].map(value => value === "4x1" ? "1x4" : value === "4x1+0+0" ? "1x4+0+0" : value === "4x1+1+0" ? "1x4+0+1" : value), method: "CompareAny", geometry: "1x4+0+0;1x1+0+1;1x1+0+1;", pixels: red.repeat(4) + blue + red },
    { name: "clear after a partial patch", frames: [...base, ...patch, ...erase], method: "CompareClear", geometry: "4x1+0+0;1x1+3+0;", pixels: red.repeat(4) + clear },
    { name: "any change after a partial patch", frames: [...base, ...patch, ...erase], method: "CompareAny", geometry: "4x1+0+0;1x1+1+0;1x1+3+0;", pixels: red.repeat(4) + blue + clear },
    { name: "return to full red", frames: [...base, ...patch, ...base], method: "CompareAny", geometry: "4x1+0+0;1x1+1+0;1x1+1+0;", pixels: red.repeat(4) + blue + red },
    { name: "opaque return to full red", frames: [...base, ...patch, ...base], method: "CompareOverlay", geometry: "4x1+0+0;1x1+1+0;1x1+1+0;", pixels: red.repeat(4) + blue + red },
    { name: "direct clear", frames: [...base, ...erase], method: "CompareClear", geometry: "4x1+0+0;1x1+3+0;", pixels: red.repeat(4) + clear },
    { name: "direct overlay", frames: [...base, ...patch], method: "CompareOverlay", geometry: "4x1+0+0;1x1+1+0;", pixels: red.repeat(4) + blue },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $method retains the canvas for $name`, async ({ frames, method, geometry, pixels }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [...frames, ...(method === "-deconstruct" ? [method] : ["-layers", method]), "-depth", "16", "-endian", "MSB", "-write", "out.rgba", "-format", "%wx%h%O;", "info:"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(geometry);
        const output = mode === "sync" || mode === "buffered" ? files.get("out.rgba")! : await fs.readFile("/out.rgba");
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
    });
}
