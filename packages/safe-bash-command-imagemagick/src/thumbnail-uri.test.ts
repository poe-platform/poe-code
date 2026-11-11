import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array([...new TextEncoder().encode("P5\n3 2\n255\n"), 1, 2, 3, 4, 5, 6]);

// URI expectations verified against native ImageMagick.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["plain.pgm", "./plain.pgm"],
        ["frame 1.pgm", "./frame%201.pgm"],
        ["p%20.pgm", "./p%2520.pgm"],
        ["frames/p%20.pgm", "./frames/p%2520.pgm"],
        ["é#+.pgm", "./%C3%A9%23%2B.pgm"],
        ["a!$&'()+,;=@[]~_.-.pgm", "./a%21%24%26%27%28%29%2B%2C%3B%3D%40%5B%5D~_.-.pgm"],
        ["/frame 1.pgm", "file:///frame%201.pgm"],
    ])(`${mode} encodes thumbnail URI for %s`, async (filename, uri) => {
        const filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/frames", { recursive: true });
        await filesystem.writeFile(filename.startsWith("/") ? filename : `/${filename}`, input);
        const files = new Map([[filename, input]]);
        const argv = [filename, "-thumbnail", "2x2", "-write", "out.png", "-format", "%[Thumb::URI]", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(uri);
        const bytes = mode === "sync" || mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png");
        expect(decodeImage(bytes).properties?.["Thumb::URI"]).toBe(uri);
    });
}
