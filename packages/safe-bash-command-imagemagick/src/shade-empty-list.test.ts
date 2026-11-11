import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["before input", ["-shade", "30x45", "/in.ppm"], false],
        ["empty parentheses", ["/in.ppm", "(", "-shade", "30x45", "/in.ppm", ")"], false],
        ["after deletion", ["/in.ppm", "+delete", "-shade", "30x45", "/in.ppm"], false],
        ["after input", ["/in.ppm", "-shade", "30x45"], true],
        ["on a clone", ["/in.ppm", "(", "+clone", "-shade", "30x45", "-write", "/clone.ppm", "+delete", ")"], true],
    ] as const)(`${mode}: shade %s`, async (name, operands, succeeds) => {
        const input = new Uint8Array(Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff40a0209020a0101220", "hex")]));
        const destination = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out.ppm", destination]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = [...operands, "/out.ppm"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.ppm") : files.get("/out.ppm")!;
        expect(result.exitCode).toBe(succeeds ? 0 : 1);
        if (!succeeds) {
            expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-shade'");
            expect(output).toEqual(destination);
        } else if (name === "on a clone") {
            expect(decodeImage(output).data).toEqual(decodeImage(input).data);
            const clone = mode === "command" || mode === "retained" ? await fs.readFile("/clone.ppm") : files.get("/clone.ppm")!;
            expect(decodeImage(clone).data).not.toEqual(decodeImage(input).data);
        } else {
            expect(decodeImage(output).data).not.toEqual(decodeImage(input).data);
        }
    });
}
