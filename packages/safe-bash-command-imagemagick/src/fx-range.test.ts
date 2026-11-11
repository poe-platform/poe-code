import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function convert(args: string[]) {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        return args.at(-1) === "info:" ? "stdout" in result ? result.stdout : stdout
            : Array.from(mode === "sync" || mode === "buffered" ? files.get("/out.raw")! : await fs.readFile("/out.raw"));
    }

    // ImageMagick 7 Q16-HDRI keeps FX results until an explicit clamp or integer output.
    it.each([
        ["1.2", ["-evaluate", "multiply", "0.5"], 0x99],
        ["-0.1", ["-evaluate", "add", "50%"], 0x66],
        ["0.5", ["-evaluate", "multiply", "0.5"], 0x40],
        ["1.2", [], 0xff],
        ["-0.1", [], 0x00],
        ["1.2", ["-clamp", "-evaluate", "multiply", "0.5"], 0x80],
        ["-0.1", ["-clamp", "-evaluate", "add", "50%"], 0x80],
        ["1.2", ["-fx", "u/2"], 0x99],
        ["-0.1", ["-fx", "u+0.5"], 0x66],
    ] as const)(`${mode}: FX %s followed by %j`, async (expression, operations, expected) => {
        expect(await convert(["xc:white", "-fx", expression, ...operations, "-depth", "8", "gray:/out.raw"])).toEqual([expected]);
    });

    it.each(["1.2", "-0.1", "0.5"])(`${mode}: queries unclamped FX %s`, async expression => {
        expect(await convert(["xc:white", "-fx", expression, "-format", "%[fx:r]", "info:"])).toBe(expression);
    });

    it(`${mode}: samples another FX image and coordinates without clipping`, async () => {
        expect(await convert(["xc:black", "(", "xc:white", "-fx", "1.2", ")", "-fx", "v.p{0,0}/2", "-depth", "8", "gray:/out.raw"])).toEqual([0x99]);
    });

    it(`${mode}: preserves selected and untouched channels across FX chunks`, async () => {
        expect(await convert(["-size", "1025x1", "xc:rgba(20%,40%,60%,0.8)", "-channel", "R", "-fx", "1.2",
            "-channel", "G", "-fx", "-0.1", "-channel", "R", "-evaluate", "multiply", "0.5",
            "-channel", "G", "-evaluate", "add", "50%", "+channel", "-depth", "8", "rgba:/out.raw"]))
            .toEqual(Array.from({ length: 1025 }, () => [153, 102, 153, 204]).flat());
    });
}
