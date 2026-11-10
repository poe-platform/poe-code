import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: separated alpha after a zero warp.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const [alpha, warp, expected] of [
    ["Disassociate", "-swirl", "00"],
    ["Disassociate", "-implode", "00"],
    ["Disassociate", "", "60"],
    ["Discrete", "-swirl", "60"],
    ["Discrete", "-implode", "60"],
    ["On", "-swirl", "60"],
    ["On", "-implode", "60"],
    ["Off", "-swirl", "00"],
    ["Off", "-implode", "00"],
] as const) {
    it(`${mode}: separates alpha after ${alpha} and ${warp || "no warp"}`, async () => {
        const argv = ["xc:#80402060", "-alpha", alpha, ...(warp ? [warp, "0"] : []),
            "-channel", "A", "-separate", "+channel", "-depth", "8", "gray:out"];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
