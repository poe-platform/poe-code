import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI status and destination bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { args: ["-channel", "R", "xc:red"], option: "-channel", hex: "4b454550" },
        { args: ["+channel", "xc:red"], option: "+channel", hex: "4b454550" },
        { args: ["xc:red", "xc:blue", "-delete", "0--1", "-channel", "B", "xc:green"], option: "-channel", hex: "4b454550" },
        { args: ["xc:red", "-delete", "0", "+channel", "xc:green"], option: "+channel", hex: "4b454550" },
        { args: ["xc:red", "-channel", "R"], option: "", hex: "ff0000" },
        { args: ["xc:red", "-channel", "R", "+channel"], option: "", hex: "ff0000" },
    ])(`${mode}: requires a current image for $args`, async ({ args, option, hex }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/dest", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/dest", keep);
        const argv = [...args, "-depth", "8", "rgb:/dest"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        const output = mode === "buffered" || mode === "sync" ? files.get("/dest")! : await fs.readFile("/dest");
        expect(result.exitCode, stderr).toBe(option ? 1 : 0);
        expect(Buffer.from(output).toString("hex")).toBe(hex);
        if (option) expect(stderr).toContain(`no images found for operation '${option}'`);
        else expect(stderr).toBe("");
    });
}
