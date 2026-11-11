import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 results.
for (const mode of ["command", "buffered", "sync"])
for (const operators of [["-coalesce"], ["-layers", "Coalesce"], []])
for (const inactive of [false, true])
for (const format of ["rgba", "PNG32"])
it(`${mode} ${format}: ${operators.join(" ") || "no coalesce"}, alpha ${inactive ? "Off" : "active"}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-respect-parentheses", "(", "xc:#ff000080", ")",
        "(", "xc:#0000ff80", ...(inactive ? ["-alpha", "Off"] : []), ")",
        ...operators, "-delete", "0", "-depth", "8", `${format}:/out`];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(format === "rgba" ? output : decodeImage(output).data).toString("hex")).toBe(inactive ? "0000ffff" : operators.length ? "5500aac0" : "0000ff80");
});
