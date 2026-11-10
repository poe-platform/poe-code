import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["1, ,2", "1,,2", "1,2"])(`skips empty duplicate scene fields in ${mode}: %s`, async spec => {
        const fs = new MemoryFileSystem();
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-duplicate", spec, "+append", "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        // Native ImageMagick 7.1.2-35 Q16-HDRI appends the selected blue frame.
        expect(Buffer.from(output).toString("hex")).toBe("ff000000ff000000ffffffff0000ff");
    });
}
