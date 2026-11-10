import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const option of ["-raise", "+raise"])
it.each(["2x1", "2x1#", "2x1,3"])(`preserves both bevel dimensions for ${option} %s, ${mode}`, async geometry => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", original);
    const argv = ["-size", "8x6", "xc:#7040b080", "-set", "option:band", "2x1",
        option, geometry, "-crop", "2x2+0+0", "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI top-left 2x2 RGBA samples.
    expect(Buffer.from(output).toString("hex")).toBe(option === "-raise"
        ? "b39ad5bcb39ad5bc9471c4a09471c4a0" : "3b225d443b225d445330835f5330835f");
});
