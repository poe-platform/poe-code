import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const option of ["-raise", "+raise"])
it.each(["2:1", "2x1"])(`renders native bevel pixels for ${option} %s, ${mode}`, async geometry => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", original);
    const args = ["-size", "8x6", "xc:#7040b080", "-set", "option:band", "2x1", option, geometry, "-crop", "2x2+0+0", "-depth", "8", "rgba:out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI, including alpha shading.
    expect(Buffer.from(output).toString("hex")).toBe(option === "-raise"
        ? "b39ad5bcb39ad5bc9471c4a09471c4a0" : "3b225d443b225d445330835f5330835f");
});
