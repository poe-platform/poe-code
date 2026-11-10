import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 results.
for (const mode of ["map", "command"] as const)
it.each([
    { alpha: "Discrete", expected: [32, 64, 96, 32] },
    { alpha: "Deactivate", expected: [32, 64, 96, 32] },
    { alpha: "On", expected: [85, 64, 96, 32] },
    { alpha: undefined, expected: [32, 64, 96, 255] },
])(`${mode}: Hald interpolates colors with lookup alpha=$alpha`, async ({ alpha, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = ["xc:#20406080", "(", "hald:2",
        ...alpha ? ["-alpha", "set", "-channel-fx", "r=>a", "-alpha", alpha] : [],
        ")", "-hald-clut", "+channel", "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "map" ? await runMagickCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(mode === "map" ? files.get("/out") : await fs.readFile("/out")).toEqual(Uint8Array.from(expected));
});
