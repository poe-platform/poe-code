import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { reset: ["+path"], missing: false },
        { reset: ["-path", "b"], missing: false },
        { reset: ["+path", "+path"], missing: false },
        { reset: ["+path"], missing: true }
    ])(`resets the mogrify destination per input (${mode}): %j`, async ({ reset, missing }) => {
        const encoder = new TextEncoder();
        const files = new Map([
            ["a/x.ppm", encoder.encode("P3\n1 1\n255\n255 0 0\n")],
            ["b/x.ppm", encoder.encode("P3\n1 1\n255\n0 0 255\n")],
            ["a/color.v1.ppm", encoder.encode("P3\n1 1\n255\n170 70 30\n")]
        ]);
        const originals = new Map(files);
        const filesystem = new MemoryFileSystem();
        for (const dir of ["a", "b", "dest"]) await filesystem.mkdir(`/${dir}`);
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = ["mogrify", "-negate", "-path", "dest", "a/x.ppm", ...reset, missing ? "b/missing.ppm" : "b/x.ppm"];
        const retained = mode === "retained" || mode === "command";
        let result;
        if (mode === "command") {
            let stdout = "", stderr = "";
            const arguments_ = createCommandArguments(argv);
            const command = createMagickCommand();
            const status = await command.execute({
                command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            } as CommandContext);
            result = { ...status, stdout, stderr };
        } else {
            result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        }
        expect(result).toEqual({
            exitCode: missing ? 1 : 0, stdout: "",
            stderr: missing ? "mogrify: unable to open image 'b/missing.ppm': No such file or directory\n" : ""
        });
        const paths = retained
            ? (await Promise.all(["a", "b", "dest"].map(async dir =>
                (await filesystem.readdir(`/${dir}`)).map(entry => `${dir}/${entry.name}`)))).flat()
            : [...files.keys()];
        expect(paths.sort()).toEqual(["a/color.v1.ppm", "a/x.ppm", "b/x.ppm", "dest/x.ppm"]);
        for (const path of ["a/x.ppm", "a/color.v1.ppm"]) {
            expect(retained ? await filesystem.readFile(`/${path}`) : files.get(path)).toEqual(originals.get(path));
        }
        for (const [path, pixels] of [
            ["dest/x.ppm", [0, 255, 255, 255]],
            ["b/x.ppm", missing ? [0, 0, 255, 255] : [255, 255, 0, 255]]
        ] as const) {
            const bytes = retained ? await filesystem.readFile(`/${path}`) : files.get(path)!;
            expect(Array.from(decodeImage(bytes).data)).toEqual(pixels);
        }
    });
}
