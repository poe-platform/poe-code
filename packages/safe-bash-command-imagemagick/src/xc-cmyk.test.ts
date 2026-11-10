import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
    it.each([
        ["xc:cmyk(1,0,0,1)", "CMYK 0.00392157 0.00392157"],
        ["xc:cmyk(25,25,25,10)", "CMYK 0.0980392 0.0392157"],
        ["xc:cmyk(10%,10%,10%,4%)", "CMYK 0.1 0.04"],
        ["canvas:cmyk(25,25,25,10)", "CMYK 0.0980392 0.0392157"],
        ["xc:#4080c0", "sRGB 0.25098 0.25098"],
        ["ink.pam", "CMYK 0.0980392 0.0392157"],
    ])(`${mode}: preserves the input color model of %s`, async (input, expected) => {
        const header = new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n");
        const files = new Map([
            ["ink.pam", Uint8Array.from([...header, 25, 25, 25, 10, 200, 31, 0, 150, 60, 128, 220, 201, 20, 80, 10, 255])],
            ["out", new TextEncoder().encode("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argumentValues = createCommandArguments([input, "-format", "%[colorspace] %[fx:u.r] %[fx:u.k]", "info:out"]);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        expect(new TextDecoder().decode(mode === "sync" ? files.get("out")! : await fs.readFile("/out"))).toBe(expected);
    });
}
