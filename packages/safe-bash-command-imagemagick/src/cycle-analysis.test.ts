import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const used = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAABlBMVEUgQGDIoIwUq6epAAAACklEQVR4nGNwAAAAQgBBKTf07wAAAABJRU5ErkJggg==", "base64");
const unused = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEUgQGDIoIwUq6epAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including unused palette entries.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "used -depth 8", input: used, options: ["-depth", "8"], output: "rgba:/out", expected: Buffer.from("204060ffc8a08cff", "hex") },
        { name: "used -cycle 1 -depth 8", input: used, options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("c8a08cff204060ff", "hex") },
        { name: "unused -depth 8", input: unused, options: ["-depth", "8"], output: "rgba:/out", expected: Buffer.from("204060ff", "hex") },
        { name: "unused -cycle 1 -depth 8", input: unused, options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("c8a08cff", "hex") },
        { name: "used -auto-gamma -depth 8", input: used, options: ["-auto-gamma", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("2a4c6dffceaa97ff", "hex") },
        { name: "used -auto-gamma -cycle 1 -depth 8", input: used, options: ["-auto-gamma", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ceaa97ff2a4c6dff", "hex") },
        { name: "unused -auto-gamma -depth 8", input: unused, options: ["-auto-gamma", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("5a809cff", "hex") },
        { name: "unused -auto-gamma -cycle 1 -depth 8", input: unused, options: ["-auto-gamma", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("e2cabdff", "hex") },
        { name: "used -channel R -auto-gamma +channel -depth 8", input: used, options: ["-channel", "R", "-auto-gamma", "+channel", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("294060ffcea08cff", "hex") },
        { name: "used -channel R -auto-gamma +channel -cycle 1 -depth 8", input: used, options: ["-channel", "R", "-auto-gamma", "+channel", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("cea08cff294060ff", "hex") },
        { name: "unused -channel R -auto-gamma +channel -depth 8", input: unused, options: ["-channel", "R", "-auto-gamma", "+channel", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("804060ff", "hex") },
        { name: "unused -channel R -auto-gamma +channel -cycle 1 -depth 8", input: unused, options: ["-channel", "R", "-auto-gamma", "+channel", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("eba08cff", "hex") },
        { name: "used -normalize -depth 8", input: used, options: ["-normalize", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("000b57ffffeebfff", "hex") },
        { name: "used -normalize -cycle 1 -depth 8", input: used, options: ["-normalize", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffeebfff000b57ff", "hex") },
        { name: "unused -normalize -depth 8", input: unused, options: ["-normalize", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("204060ff", "hex") },
        { name: "unused -normalize -cycle 1 -depth 8", input: unused, options: ["-normalize", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffffffff", "hex") },
        { name: "used -contrast-stretch 0% -depth 8", input: used, options: ["-contrast-stretch", "0%", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("000b57ffffeebfff", "hex") },
        { name: "used -contrast-stretch 0% -cycle 1 -depth 8", input: used, options: ["-contrast-stretch", "0%", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffeebfff000b57ff", "hex") },
        { name: "unused -contrast-stretch 0% -depth 8", input: unused, options: ["-contrast-stretch", "0%", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("204060ff", "hex") },
        { name: "unused -contrast-stretch 0% -cycle 1 -depth 8", input: unused, options: ["-contrast-stretch", "0%", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffffffff", "hex") },
        { name: "used -linear-stretch 0% -depth 8", input: used, options: ["-linear-stretch", "0%", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("89ffffffffffffff", "hex") },
        { name: "used -linear-stretch 0% -cycle 1 -depth 8", input: used, options: ["-linear-stretch", "0%", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffffffff89ffffff", "hex") },
        { name: "unused -linear-stretch 0% -depth 8", input: unused, options: ["-linear-stretch", "0%", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("89ffffff", "hex") },
        { name: "unused -linear-stretch 0% -cycle 1 -depth 8", input: unused, options: ["-linear-stretch", "0%", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffffffff", "hex") },
        { name: "used -equalize -depth 8", input: used, options: ["-equalize", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("008080ffff8080ff", "hex") },
        { name: "used -equalize -cycle 1 -depth 8", input: used, options: ["-equalize", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ff8080ff008080ff", "hex") },
        { name: "unused -equalize -depth 8", input: unused, options: ["-equalize", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("00ffffff", "hex") },
        { name: "unused -equalize -cycle 1 -depth 8", input: unused, options: ["-equalize", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffffffff", "hex") },
        { name: "used -channel R -equalize +channel -depth 8", input: used, options: ["-channel", "R", "-equalize", "+channel", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("804060ffffa08cff", "hex") },
        { name: "used -channel R -equalize +channel -cycle 1 -depth 8", input: used, options: ["-channel", "R", "-equalize", "+channel", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffa08cff804060ff", "hex") },
        { name: "unused -channel R -equalize +channel -depth 8", input: unused, options: ["-channel", "R", "-equalize", "+channel", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ff4060ff", "hex") },
        { name: "unused -channel R -equalize +channel -cycle 1 -depth 8", input: unused, options: ["-channel", "R", "-equalize", "+channel", "-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("ffa08cff", "hex") },
    ])(`${mode}: $name`, async ({ input, options, output, expected }) => {
        const files = new Map<string, Uint8Array>([["/in", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in", ...options, output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect([...actual]).toEqual([...expected]);
    });
}
