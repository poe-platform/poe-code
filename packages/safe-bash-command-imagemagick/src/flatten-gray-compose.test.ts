import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Gray canvases retain only the red/gray channel.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]])
for (const depth of [8, 16])
it.each([
    { compose: "Copy", space: "sRGB", hex: "e8e8e840", hex16: "e8e8e8e8e8e84040" },
    { compose: "Multiply", space: "sRGB", hex: "535353a0", hex16: "538853885388a080" },
    { compose: "Over", space: "sRGB", hex: "797979a0", hex16: "79aa79aa79aaa080" },
    { compose: "Copy", space: "Gray", hex: "87878740", hex16: "87b687b687b64040" }
])(`${mode} ${operation.join(" ")} $compose from $space onto Gray at depth ${depth}`, async ({ compose, space, hex, hex16 }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["(", "xc:#12345680", "-colorspace", "Gray", "-repage", "3x1+0+0", ")",
        "(", "xc:#e8742840", "-colorspace", space, "-repage", "3x1+0+0", ")",
        "-background", "none", "-compose", compose, ...operation,
        "-format", "%[colorspace]", "-write", "info:/info", "-colorspace", "sRGB", "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    const info = mode === "command" || mode === "retained" ? await fs.readFile("/info") : files.get("/info")!;
    expect(new TextDecoder().decode(info)).toBe("Gray");
    const padding = operation.includes("merge") ? "" : "0".repeat(depth === 16 ? 32 : 16);
    expect(Buffer.from(bytes).toString("hex")).toBe((depth === 16 ? hex16 : hex) + padding);
});
