import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Uncompressed MIFF for the native 4x2 RGBA disposal repro. Native ImageMagick
// reports Previous for dispose=Previous and Undefined when the field is absent.
function frame(dispose?: string) {
    const header = `id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=4 rows=2 depth=8\ncolorspace=sRGB compression=None\n${dispose === undefined ? "" : `dispose=${dispose}\n`}\f\n:\x1a`;
    const row = [0x12, 0x34, 0xab, 0xcd, 0xff, 0, 0x80, 0xff, 0x12, 0x34, 0xab, 0xcd, 0x55, 0x66, 0, 0x80];
    return new Uint8Array([...new TextEncoder().encode(header), ...row, ...row]);
}

for (const mode of ["command", "sync"] as const) {
    it.each([
        { inputs: ["previous.miff"], expected: "Previous" },
        { inputs: ["plain.miff"], expected: "Undefined" },
        { inputs: ["undefined.miff"], expected: "Undefined" },
        { inputs: ["none.miff"], expected: "None" },
        { inputs: ["background.miff"], expected: "Background" },
        { inputs: ["sequence.miff"], expected: "PreviousUndefinedBackgroundNone" },
        { inputs: ["sequence.miff[2]"], expected: "Background" },
        { inputs: ["previous.miff", "plain.miff"], expected: "PreviousUndefined" },
        { inputs: ["-dispose", "None", "previous.miff"], expected: "None" },
        { inputs: ["previous.miff", "-set", "dispose", "Background"], expected: "Background" }
    ])(`reads MIFF frame disposal (${mode}): $inputs`, async ({ inputs, expected }) => {
        const files = new Map([
            ["previous.miff", frame("Previous")], ["plain.miff", frame()],
            ["undefined.miff", frame("Undefined")], ["none.miff", frame("None")],
            ["background.miff", frame("Background")],
            ["sequence.miff", new Uint8Array([...frame("Previous"), ...frame(), ...frame("Background"), ...frame("None")])]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const args = [...inputs, "-format", "%D", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
