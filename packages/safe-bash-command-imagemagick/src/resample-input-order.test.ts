import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Buffer.from("ff000000ff000000ffffee00991177245384", "hex");
const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...pixels]);
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { placement: "before input", args: ["-resample", "72", "im.ppm"], valid: false },
        { placement: "before missing input", args: ["-resample", "72", "missing.ppm"], valid: false },
        { placement: "after delete", args: ["im.ppm", "+delete", "-resample", "72", "im.ppm"], valid: false },
        { placement: "density only", args: ["im.ppm", "-density", "72", "-filter", "point"], valid: true },
        { placement: "after input", args: ["im.ppm", "-density", "72", "-filter", "point", "-resample", "144"], valid: true },
    ])(`requires a current image for resample: $placement (${mode})`, async ({ placement, args, valid }) => {
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
            expect.soft(result.stderr).toContain("no images found for operation '-resample'");
            expect(output).toEqual(keep);
        } else {
            expect(result.stderr).toBe("");
            // Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 controls.
            expect(output.length).toBe(placement === "after input" ? 72 : 18);
            expect(createHash("sha256").update(output).digest("hex")).toBe(placement === "after input"
                ? "d1ebfc840746c703e5a65cd3dcf470be292962aa8749d7395640e34c19af2298"
                : "6506f1e2b70ee28fae8fbae9489470c1ab444d3f9bd3182f235a0c2851188895");
        }
    });
}
