import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Hald sampling uses the cube's interpolation,
// unlike ordinary CLUT, whose lookup extent also depends on the source.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [method, sampled] of [["Nearest", "ffaaaa"], ["Integer", "aacfbf"], ["Spline", "d69fca"]] as const)
for (const placement of ["table", "source", "outer", "before-table", "reset", "override"] as const)
it(`${mode}: Hald ${method} interpolation in ${placement}`, async () => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["-respect-parentheses", "(", "xc:#dfcfbf",
        ...(placement === "source" ? ["-interpolate", method] : []), ")", "(",
        ...(placement === "before-table" ? ["-interpolate", method] : []), "hald:2",
        ...(["table", "reset", "override"].includes(placement) ? ["-interpolate", method] : []), ")",
        ...(placement === "outer" ? ["-interpolate", method] : []),
        ...(placement === "reset" ? ["+interpolate"] : []),
        ...(placement === "override" ? ["-interpolate", "Bilinear"] : []),
        "-hald-clut", "-depth", "8", "rgb:/out"];
    if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(["source", "reset", "override"].includes(placement) ? "dfcfbf" : sampled);
});
