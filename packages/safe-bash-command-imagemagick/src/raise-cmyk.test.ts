import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [option, channel, separated, expected] of [["-raise", "K", "K", "a2a2a2ff"], ["-raise", "R", "R", "a9a9a9ff"], ["-raise", "A", "A", "bcbcbcff"], ["+raise", "K", "K", "2a2a2aff"], ["", "K", "K", "4f4f4fff"], ["-raise", "R", "K", "4f4f4fff"], ["+raise", "R", "K", "4f4f4fff"], ["-raise", "K", "A", "808080ff"], ["+raise", "K", "A", "808080ff"]] as const)
it(`shades CMYK ${channel} with ${option || "no bevel"}, ${mode}, separating ${separated}`, async () => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", original);
    const args = ["-size", "8x6", "xc:#7040b080", "-colorspace", "CMYK", "-channel", channel, ...(option ? [option, "2x1"] : []), "+channel", "-channel", separated, "-separate", "-crop", "1x1+0+0", "-depth", "8", "rgba:out"];
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
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
