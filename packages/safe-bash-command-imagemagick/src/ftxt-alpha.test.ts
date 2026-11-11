import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operand of ["ftxt:/pixels.dat", "ftxt:-"]) {
    it.each([
        { name: "alpha", options: ["-define", "ftxt:hasalpha=true"], alpha: true },
        { name: "opaque default", options: [], alpha: false },
        { name: "disabled alpha", options: ["-define", "ftxt:hasalpha=false"], alpha: false },
        { name: "removed alpha", options: ["-define", "ftxt:hasalpha=true", "+define", "ftxt:hasalpha"], alpha: false }
    ])(`${mode} ${operand}: $name`, async ({ options, alpha }) => {
        const bytes = new TextEncoder().encode(alpha ? "0,0:65535,0,0,32768\n1,0:0,0,65535,65535\n" : "0,0:65535,0,0\n1,0:0,0,65535\n");
        const argv = ["-size", "2x1", ...options, operand, "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map([["/pixels.dat", bytes]]);
        await fs.writeFile("/pixels.dat", bytes);
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () { yield bytes; })(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout += Buffer.from(chunk).toString("hex"); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files, bytes)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files, bytes);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
        expect(hex).toBe(alpha ? "ff0000800000ffff" : "ff0000ff0000ffff");
    });
}


// Cross both the text read boundary and the four-channel raster write boundary.
for (const retained of [false, true]) {
    it(`preserves Q16 alpha across chunks (retained: ${retained})`, async () => {
        const width = 2000;
        const bytes = new TextEncoder().encode(Array.from({ length: width }, (_, x) => `${x},0:65535,0,0,${x}`).join("\n"));
        const fs = new MemoryFileSystem(), files = new Map([["/pixels.dat", bytes]]);
        await fs.writeFile("/pixels.dat", bytes);
        const result = await runMagickCli(["-size", `${width}x1`, "-define", "ftxt:hasalpha=true", "ftxt:/pixels.dat", "/out.png"],
            retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(image.data16!)).toEqual(Array.from({ length: width }, (_, x) => [65535, 0, 0, x]).flat());
    });
}
