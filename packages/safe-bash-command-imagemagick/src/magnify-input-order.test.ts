import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const colors = ["ef4020", "2266ee", "17df90"];
const pixels = Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(i => colors[i]).join(""), "hex");
const input = new Uint8Array([...new TextEncoder().encode("P6\n3 3\n255\n"), ...pixels]);
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { placement: "before input", args: ["-magnify", "im.ppm"], valid: false },
        { placement: "after delete", args: ["im.ppm", "+delete", "-magnify", "im.ppm"], valid: false },
        { placement: "empty parentheses", args: ["im.ppm", "(", "-magnify", "im.ppm", ")"], valid: false },
        { placement: "after input", args: ["im.ppm", "-magnify"], valid: true },
    ])(`requires a current image for magnify: $placement (${mode})`, async ({ args, valid }) => {
        const files = new Map([["im.ppm", input], ["out", keep]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const argv = [...args, "-depth", "8", "rgb:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        if (!valid) {
            expect.soft(result.stderr).toContain("no images found for operation '-magnify'");
            expect(output).toEqual(keep);
        } else {
            expect(result.stderr).toBe("");
            // Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 controls.
            expect(output.length).toBe(108);
            expect(createHash("sha256").update(output).digest("hex")).toBe("4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a");
        }
    });
}
