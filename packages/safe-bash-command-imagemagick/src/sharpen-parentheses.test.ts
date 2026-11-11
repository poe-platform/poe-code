import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each(["(0x2)", "0x2", "0x2!", "0x2%"])(`uses the enclosed sharpen geometry %s (${mode})`, async geometry => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["xc:#50406080", "xc:#a08090c0", "+append", "-sharpen", geometry, "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI, including sharpened alpha.
    expect(Buffer.from(output).toString("hex")).toBe("17123e67b28f9bd9");
});
