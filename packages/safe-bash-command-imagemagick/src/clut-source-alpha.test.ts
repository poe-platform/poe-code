import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 results after reactivating source alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { alpha: "Discrete", table: "transparent", expected: "76aac870" },
    { alpha: "Discrete", table: "rgb", expected: "204060ff" },
    { alpha: "Discrete", table: "opaque", expected: "204060ff" },
    { alpha: "Activate", table: "transparent", expected: "76aac870" },
    { alpha: "Deactivate", table: "transparent", expected: "76aac880" },
    { alpha: "Deactivate", table: "rgb", expected: "20406080" },
])(`${mode}: CLUT maps stored source alpha=$alpha with $table table`, async ({ alpha, table, expected }) => {
    const argv = ["(", "xc:#20406080", "-alpha", alpha, ")",
        "(", table === "rgb" ? "xc:black" : "xc:#00000020", table === "rgb" ? "xc:white" : "xc:#ffffffc0",
        "+append", ...(table === "opaque" ? ["-alpha", "Opaque"] : []), ")",
        "-clut", "-alpha", "activate", "-depth", "8", `rgba:${mode === "command" ? "-" : "/out"}`];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
    expect(hex).toBe(expected);
});
