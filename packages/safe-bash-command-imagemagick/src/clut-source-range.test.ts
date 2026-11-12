import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with and without explicit source clamping.
for (const mode of ["map", "sync", "filesystem", "command"])
for (const clamp of [false, true])
it.each([
    ["spline", "2104745b47e67a602104745b47e6a48a"],
    ["catrom", "230b88184f0c75a4230b88184f0cb9ca"],
    ["average9", "42ed8d377d27676742ed8d377d279b9b"],
    ["average16", "3cfd93d3763681813cfd93d376368181"],
])(`${mode}: %s clamps above-white source indices (clamp=${clamp})`, async (method, expected) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = ["(", "xc:#173e5970", "xc:#b56829cf", "+append", "-channel", "RGB",
        "-evaluate", "add", "150%", "+channel", ...(clamp ? ["-clamp"] : []), ")",
        "(", "(", "xc:#7258b433", "xc:#2ba761cf", "+append", ")", ")",
        "-interpolate", method!, "-clut", "-depth", "16", "-endian", "MSB", "rgba:/out"];
    if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" }))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const bytes = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
