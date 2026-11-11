import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "public"]) {
    const retained = mode !== "buffered";
    for (const intermediate of [false, true]) {
        it.each([
            { options: [], target: "pal.txt", names: ["pal.txt"] },
            { options: ["+adjoin"], target: "pal.txt", names: ["pal-0.txt", "pal-1.txt"] },
            { options: ["-scene", "4", "+adjoin"], target: "pal.txt", names: ["pal-4.txt", "pal-5.txt"] },
            { options: [], target: "pal-%02d.txt", names: ["pal-00.txt", "pal-01.txt"] },
            { options: ["-scene", "4"], target: "pal-%02d.txt", names: ["pal-04.txt", "pal-05.txt"] },
        ])(`writes sparse-color frames to $names (mode=${mode}, intermediate=${intermediate})`, async ({ options, target, names }) => {
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const destination = `sparse-color:${target}`;
            const args = ["xc:red", "xc:blue", ...options, ...(intermediate ? ["-write", destination, "null:"] : [destination])];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(retained ? (await filesystem.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].sort()).toEqual([...names].sort());
            const contents = ["0,0,srgb(255,0,0) ", "0,0,srgb(0,0,255) "];
            for (const [index, name] of names.entries()) {
                expect(new TextDecoder().decode(retained ? await filesystem.readFile(`/${name}`) : files.get(name))).toBe(names.length === 1 ? contents.join("") : contents[index]);
            }
        });
    }
}
