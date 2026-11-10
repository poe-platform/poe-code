import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "option", options: ["-set", "option:radius", "1"], radius: "%[option:radius]", valid: true },
        { name: "literal with option", options: ["-set", "option:radius", "1"], radius: "1", valid: true },
        { name: "FX", options: [], radius: "%[fx:1]", valid: true },
        { name: "literal", options: [], radius: "1", valid: true },
        { name: "image FX", options: [], radius: "%[fx:w/3]", valid: true },
        { name: "invalid option", options: ["-set", "option:radius", "oops"], radius: "%[option:radius]", valid: false },
        { name: "empty option", options: ["-set", "option:radius", ""], radius: "%[option:radius]", valid: false },
    ])(`${mode}: expands edge radius $name before validation`, async ({ options, radius, valid }) => {
        const files = new Map([["/out.raw", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out.raw", files.get("/out.raw")!);
        const args = ["xc:#405060", "xc:#506080", "xc:#203030", "+append", ...options,
            "-edge", radius, "-depth", "8", "rgba:/out.raw"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(valid ? 0 : 1);
        expect(error).toEqual(valid ? "" : expect.stringContaining("invalid argument for option '-edge'"));
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        // Native ImageMagick 7.1.2-35 Q16-HDRI, including both literal controls.
        expect(Buffer.from(bytes).toString("hex")).toBe(valid ? "000000ffc0c0ffff000000ff" : "4b454550");
    });
}
