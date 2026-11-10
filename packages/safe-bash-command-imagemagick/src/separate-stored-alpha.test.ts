import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const execution of ["command", "buffered", "sync"] as const)
for (const [alpha, space, channel, combine, expected] of [
    ["Discrete", "sRGB", "All", false, "80402860"],
    ["Discrete", "sRGB", "A", false, "60"],
    ["Discrete", "sRGB", "All", true, "80402860"],
    ["Disassociate", "sRGB", "All", false, "ffaa6a60"],
    ["Disassociate", "sRGB", "A", false, "60"],
    ["Disassociate", "sRGB", "All", true, "ffaa6a60"],
    ["Discrete", "CMYK", "All", false, "0080af7f60"],
    ["On", "sRGB", "All", true, "80402860"],
    ["Off", "sRGB", "All", false, "804028"],
    ["Deactivate", "sRGB", "All", false, "804028"],
    ["Associate", "sRGB", "All", false, "30180f"],
    ["Off", "sRGB", "A", false, "00"],
    ["", "sRGB", "A", false, "60"],
] as const) {
    it(`${execution}: separates ${channel} in ${space} after alpha ${alpha || "default"}, combine=${combine}`, async () => {
        const argv = ["xc:#80402860", "-colorspace", space, ...(alpha ? ["-alpha", alpha] : []),
            "-channel", channel, "-separate", "+channel", combine ? "-combine" : "+append", "-depth", "8", `${combine ? "rgba" : "gray"}:out`];
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "sync" ? runMagickCliSync(argv, files)
            : execution === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.from(execution === "command" ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(expected);
    });
}

for (const execution of ["command", "buffered", "sync"] as const)
for (const alpha of ["Discrete", "Disassociate"]) {
    it(`${execution}: compares the stored alpha plane after ${alpha}`, async () => {
        const argv = ["compare", "-metric", "RMSE", "(", "xc:#80402860", "-alpha", alpha,
            "-channel", "A", "-separate", "+channel", ")", "xc:gray(96)", "null:"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "sync" ? runMagickCliSync(argv, new Map())
            : execution === "buffered" ? await runMagickCli(argv, new Map())
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("0 (0)");
    });
}
