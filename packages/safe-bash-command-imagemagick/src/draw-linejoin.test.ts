import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const bevel = "438da323bd6d42e958f4e2b59c50dc0cbc14af14f9e023f61d6e8859b5c16e34";
const miter = "a8abe1178cb6d0aa38ac88d3fe47d497e124858b146462df4251aa5a7ca7f18f";
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["stroke-linejoin bevel", bevel],
        ["stroke-linejoin round", "62bd3c357fb57a30608ade4a41e959d6a7b97e6302967528a321074361123908"],
        ["stroke-linejoin miter", miter],
        ["stroke-linejoin miter stroke-miterlimit 1", bevel],
        ["stroke-miterlimit 1", bevel],
        ["", miter],
        ["push graphic-context stroke-linejoin bevel stroke-miterlimit 1 pop graphic-context", miter],
    ])(`${mode}: native stroke raster for %s`, async (directives, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        const argv = ["-size", "15x10", "xc:white", "-fill", "none", "-stroke", "black", "-strokewidth", "4",
            "-draw", `${directives} polyline 2,7 6,2 10,7`, "-depth", "8", mode === "command" ? "gray:-" : "gray:out.gray"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out.gray") : files.get("out.gray")!;
        expect(stderr).toBe("");
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
