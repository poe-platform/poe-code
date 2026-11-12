import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 requires an image in the current group for either mask form.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-write-mask", "+write-mask", "-read-mask", "+read-mask"]) {
        const mask = [option, ...(option.startsWith("-") ? ["xc:black"] : [])];
        it.each([
            { name: "before the first image", operations: [...mask, "xc:red"], hex: undefined },
            { name: "in an empty group", operations: ["xc:red", "(", ...mask, "xc:blue", ")"], hex: undefined },
            { name: "after deleting the last image", operations: ["xc:red", "+delete", ...mask, "xc:blue"], hex: undefined },
            { name: "after an image", operations: ["xc:red", ...mask], hex: "ff0000" },
            { name: "after an image in a group", operations: ["xc:red", "(", "xc:blue", ...mask, ")"], hex: "ff00000000ff" },
        ])(`${mode}: ${option} $name`, async ({ operations, hex }) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/dest", keep]]), fs = new MemoryFileSystem();
            await fs.writeFile("/dest", keep);
            const argv = [...operations, "-depth", "8", "rgb:/dest"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(hex === undefined ? 1 : 0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe(hex === undefined
                ? `magick: no images found for operation '${option}'\n` : "");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/dest") : files.get("/dest")!;
            expect(Buffer.from(output).toString("hex")).toBe(hex ?? "4b454550");
        });
    }
}
