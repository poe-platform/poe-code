import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, starting with xc:#4080a080.
const tint = ["-fill", "#bf6050", "-tint", "60%"];
const cases = [
    ...["Gray", "LinearGray"].flatMap(space => [
        { name: `${space} colored tint metadata`, operations: ["-colorspace", space, ...tint], info: true, expected: "sRGB" },
        { name: `${space} neutral tint metadata`, operations: ["-colorspace", space, "-fill", "gray50", "-tint", "60%"], info: true, expected: space },
    ]),
    { name: "LinearGray colored tint", operations: ["-colorspace", "LinearGray", ...tint], info: false, expected: "300d0780" },
    { name: "LinearGray colored tint then sRGB", operations: ["-colorspace", "LinearGray", ...tint, "-colorspace", "sRGB"], info: false, expected: "300d0780" },
    { name: "untinted LinearGray then sRGB", operations: ["-colorspace", "LinearGray", "-colorspace", "sRGB"], info: false, expected: "79797980" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native $name`, async ({ operations, info, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const target = mode === "command" ? "-" : "/out";
        const argv = ["xc:#4080a080", ...operations,
            ...(info ? ["-format", "%[colorspace]", `info:${target}`] : ["-depth", "8", `rgba:${target}`])];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(info ? "utf8" : "hex")).toBe(expected);
    });
}
