import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: named targets retain their RGB channel values.
for (const mode of ["command", "sync"] as const) {
    for (const space of ["CMYK", "sRGB"]) {
        for (const operation of ["-transparent", "+transparent"]) {
            it.each(space === "CMYK" ? ["red", "cyan", "cmyk(0%,100%,100%,0%)"] : ["red", "cyan"])(`${mode}: ${space} ${operation} %s`, async target => {
                const fs = new MemoryFileSystem();
                const files = new Map<string, Uint8Array>();
                const argumentValues = createCommandArguments(["xc:red", "-colorspace", space, operation, target,
                    "-depth", "8", `${space === "CMYK" ? "cmyka" : "rgba"}:out`]);
                let stderr = "";
                const result = mode === "sync" ? runMagickCliSync(argumentValues.args, files)
                    : await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    });
                expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
                const matched = space === "CMYK" ? target !== "red" : target !== "cyan";
                const transparent = operation === "-transparent" ? matched : !matched;
                const expected = `${space === "CMYK" ? "00ffff00" : "ff0000"}${transparent ? "00" : "ff"}`;
                expect(Buffer.from(mode === "sync" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
            });
        }
    }
}

it.each([0, 99, 100])("compares CMYK black ink separately at %s%% fuzz", fuzz => {
    const files = new Map<string, Uint8Array>();
    expect(runMagickCliSync(["xc:black", "-colorspace", "CMYK", "-fuzz", `${fuzz}%`,
        "-transparent", "black", "-depth", "8", "cmyka:out"], files).exitCode).toBe(0);
    expect(Buffer.from(files.get("out")!).toString("hex")).toBe(`000000ff${fuzz === 100 ? "00" : "ff"}`);
});
