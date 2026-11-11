import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: gray virtual pixels use half the quantum range.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    ["gray", "000000b4b4b4"],
    ["edge", "000000c0c0c0"],
    ["white", "000000000000"],
])(`${mode}: edge matches native %s virtual pixels`, async (method, expected) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:#505050", "xc:#909090", "+append", "-virtual-pixel", method!, "-edge", "1", "-depth", "8",
        mode === "command" ? "rgb:-" : "rgb:/out.raw"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(mode === "command" ? stdout : Buffer.from(mode === "retained"
        ? await fs.readFile("/out.raw") : files.get("/out.raw")!).toString("hex")).toBe(expected);
});
