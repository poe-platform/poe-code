import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "off", primitive: "color", fill: "#ff003040", expected: "ff003040000000ff204060ff" },
        { alpha: "off", primitive: "alpha", fill: "#ff003040", expected: "20406040000000ff204060ff" },
        { alpha: "deactivate", primitive: "color", fill: "#ff003040", expected: "ff003040000000ff204060ff" },
        { alpha: "deactivate", primitive: "alpha", fill: "#ff003040", expected: "20406040000000ff204060ff" },
        { alpha: "", primitive: "color", fill: "#ff003040", expected: "ff003040000000ff20406080" },
        { alpha: "opaque", primitive: "color", fill: "#ff003040", expected: "ff003040000000ff204060ff" },
        { alpha: "off", primitive: "color", fill: "red", expected: "ff0000ff000000ff204060ff" },
    ])(`${mode}: $primitive point with alpha '$alpha' and fill $fill`, async ({ alpha, primitive, fill, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#20406080", "xc:#000000ff", "xc:#20406080", "+append",
            ...(alpha ? ["-alpha", alpha] : []), "-fill", fill, "-draw", `${primitive} 0,0 point`,
            "-depth", "8", "rgba:out.rgba"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
