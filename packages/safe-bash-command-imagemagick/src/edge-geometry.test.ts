import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: all four spellings use radius 1.
for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const) {
    it.each(["1x2", "(1)", "1%", "1", "bad", "1xjunk", ""])(`${mode}: validates edge radius %j before replacing output`, async radius => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.raw", original]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out.raw", original);
        const args = ["xc:#405060", "xc:#506080", "xc:#203030", "+append", "-edge", radius, "-depth", "8", "rgba:/out.raw"];
        let stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const valid = ["1x2", "(1)", "1%", "1"].includes(radius);
        expect(result.exitCode).toBe(valid ? 0 : 1);
        expect(result.stderr).toEqual(valid ? "" : expect.stringContaining("invalid argument for option '-edge'"));
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        expect(Buffer.from(output).toString("hex")).toBe(valid ? "000000ffc0c0ffff000000ff" : "4b454550");
    });
}
