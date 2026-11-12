import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: RGB channel copies retain destination alpha.
for (const route of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { compose: "CopyCyan", flatten: false, hex: "24443380" },
    { compose: "CopyMagenta", flatten: false, hex: "aa683380" },
    { compose: "CopyYellow", flatten: false, hex: "aa44ac80" },
    { compose: "CopyRed", flatten: false, hex: "24443380" },
    { compose: "CopyGreen", flatten: false, hex: "aa683380" },
    { compose: "CopyBlue", flatten: false, hex: "aa44ac80" },
    { compose: "CopyCyan", flatten: true, hex: "aa5533702455337024553370" },
    { compose: "CopyRed", flatten: true, hex: "aa5533702455337024553370" },
])(`${route}: $compose with flatten=$flatten preserves other channels and alpha`, async ({ compose, flatten, hex }) => {
    const args = flatten
        ? ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")",
            "-background", "#33553370", "-compose", compose, "-flatten", "-depth", "8", "rgba:-"]
        : ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0", "-compose", compose, "-composite", "-depth", "8", "rgba:-"];
    const filesystem = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    if (route === "command") {
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
    } else {
        const files = new Map<string, Uint8Array>();
        args[args.length - 1] = "rgba:/out";
        const result = route === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = route === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    }
});
