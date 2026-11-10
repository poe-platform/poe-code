import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Hald initializes inactive alpha to opaque.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const depth of ["8", "16"])
it.each([
    { alpha: ["-alpha", "Discrete"], selection: ["-channel", "R"], opacity: "ff" },
    { alpha: ["-alpha", "Deactivate"], selection: ["-channel", "R"], opacity: "ff" },
    { alpha: [], selection: ["-channel", "R"], opacity: "80" },
    { alpha: ["-alpha", "Discrete"], selection: [], opacity: "ff" },
])(`${mode}, depth=${depth}: initializes Hald alpha for $alpha $selection`, async ({ alpha, selection, opacity }) => {
    const args = ["xc:#20406080", ...alpha, "(", "hald:2", ")", ...selection,
        "-hald-clut", "+channel", "-depth", depth, "-endian", "MSB", "rgba:/out"];
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stdout = "", stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toEqual({ exitCode: 0 });
        expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(depth === "8" ? `204060${opacity}` : `202040406060${opacity}${opacity}`);
});
