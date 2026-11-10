import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit RGBA destination bytes.
const cases = [
    { settings: ["-write-mask", "/mask.pgm"], clear: ["+write-mask"], hex: "585858ffc84011ff" },
    { settings: ["-region", "1x1+1+0"], clear: ["+region"], hex: "2060b0ff5a5a5aff" },
    { settings: ["-write-mask", "/mask.pgm", "-region", "1x1+1+0"], clear: ["+write-mask", "+region"], hex: "2060b0ffc84011ff" },
    { settings: [], clear: [], hex: "585858ff5a5a5aff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: combine respects selection $settings`, async ({ settings, clear, hex }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        files.set("/in.pam", Buffer.concat([Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from("2060b080c84011ef", "hex")]));
        files.set("/mask.pgm", Buffer.concat([Buffer.from("P5\n2 1\n255\n"), Buffer.from([0, 255])]));
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        const argv = ["/in.pam", "-alpha", "off", ...settings, "(", "/in.pam", "-alpha", "off", ")", "(", "/in.pam", "-alpha", "off", ")", "-combine", ...clear, "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
