import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: six labeled pixels and a one-pixel translation.
const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 0  0 255 255  255 0 255\n");
const keep = new TextEncoder().encode("KEEP");
const translated = Buffer.from("000000ff000000ff00000000ffff0000ffff", "hex");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["-", "/out.raw"].flatMap(destination => [
        { destination, operator: "-distort", method: "BogusDistortion", coefficients: "0", valid: false },
        { destination, operator: "+distort", method: "BogusDistortion", coefficients: "0", valid: false },
        { destination, operator: "-distort", method: "AffineProjection", coefficients: "1,0,0,1,1,0", valid: true },
    ]))(`handles $operator $method to $destination (${mode})`, async ({ destination, operator, method, coefficients, valid }) => {
        const files = new Map([["/in.ppm", input], ["/out.raw", keep]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", "point", operator, method, coefficients,
            ...(destination === "-" ? ["-format", "%wx%h %g;", "-write", "info:"] : []), "-depth", "8", `rgb:${destination}`];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const stdout = mode === "command" ? Buffer.concat(chunks) : Buffer.concat([
            Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : ""),
            "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array(),
        ]);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(result.exitCode).toBe(valid ? 0 : 1);
        const error = "stderr" in result ? result.stderr : stderr;
        if (valid) expect(error).toBe("");
        else {
            expect(error).toContain("unrecognized distortion method");
            expect(error).toContain(method);
        }
        expect(stdout).toEqual(valid && destination === "-"
            ? Buffer.concat([Buffer.from("3x2 3x2+0+0;"), translated]) : Buffer.alloc(0));
        expect(Buffer.from(output)).toEqual(valid && destination !== "-" ? translated : Buffer.from(keep));
    });
}
