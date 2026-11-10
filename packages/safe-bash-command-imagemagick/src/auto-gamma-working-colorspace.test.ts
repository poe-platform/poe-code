import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    ...Buffer.from("4080c0207020906020607040", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI, converted back to 8-bit sRGB RGBA.
const cases = [
    { space: "HSL", channel: "", expected: "4b6eca299221a66b2259854b" },
    { space: "HSL", channel: "R", expected: "40c092203220906020703840" },
    { space: "Lab", channel: "", expected: "b886aa37ba0d807c8d6b605c" },
    { space: "Lab", channel: "R", expected: "5b97d9208c3cab603d798940" },
    { space: "sRGB", channel: "", expected: "64a0d23e923ead833e839264" },
    { space: "sRGB", channel: "R", expected: "7a80c020a520906054607040" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: applies auto-gamma in $space with channel '$channel'`, async ({ space, channel, expected }) => {
        const files = new Map([["/in.pam", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const args = ["/in.pam", "-colorspace", space, ...(channel ? ["-channel", channel] : []), "-auto-gamma", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
