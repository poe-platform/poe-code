import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 applies comment settings only to subsequent inputs.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "option before inputs", args: ["-set", "option:comment", "hello", "xc:red", "xc:blue"], comments: ["hello", "hello"] },
        { name: "option between inputs", args: ["xc:red", "-set", "option:comment", "hello", "xc:blue"], comments: ["", "hello"] },
        { name: "option after inputs", args: ["xc:red", "xc:blue", "-set", "option:comment", "hello"], comments: ["", ""] },
        { name: "direct before inputs", args: ["-comment", "hello", "xc:red", "xc:blue"], comments: ["hello", "hello"] },
        { name: "direct between inputs", args: ["xc:red", "-comment", "hello", "xc:blue"], comments: ["", "hello"] },
        { name: "direct after inputs", args: ["xc:red", "xc:blue", "-comment", "hello"], comments: ["", ""] },
        { name: "option replaces direct", args: ["-comment", "first", "xc:red", "-set", "option:comment", "second", "xc:blue"], comments: ["first", "second"] },
        { name: "direct replaces option", args: ["-set", "option:comment", "first", "xc:red", "-comment", "second", "xc:blue"], comments: ["first", "second"] },
        { name: "unset option", args: ["-set", "option:comment", "hello", "xc:red", "+set", "option:comment", "xc:blue"], comments: ["hello", ""] },
        { name: "empty option", args: ["-set", "option:comment", "hello", "xc:red", "-set", "option:comment", "", "xc:blue"], comments: ["hello", ""] },
    ])(`${mode}: $name`, async ({ args, comments }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [...args, "gif:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        for (const [page, comment] of comments.entries()) {
            const image = decodeImage(output, { page, coalesce: false });
            expect(image.properties?.comment ?? "").toBe(comment);
            expect([...image.data]).toEqual(page === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
        }
    });
}
