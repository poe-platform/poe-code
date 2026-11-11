import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI (aarch64, with and without OpenMP), RGBA8.
const horizontal = "ff2d2dffffd2d2ffff2d2dffff0000ffff0000ffff0000ff";
for (const mode of ["command", "stdout", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["-region", "1x1+1+0", "-shear", "-10x0", "+region"], format: "rgba", hex: horizontal },
        { options: ["-region", "1x1+1+0", "-shear", "0x0", "+region"], format: "rgba", hex: "ff0000ffff0000ffff0000ffff0000ffff0000ffff0000ff" },
        { options: ["-alpha", "off", "-region", "1x1+1+0", "-shear", "10x0"], format: "PNG32", hex: "ff2d2d00ffd2d200ff2d2d00ff000000ff000000ff000000" },
        { options: ["-region", "1x1+1+0", "-shear", "10x0", "+region"], format: "rgba", hex: horizontal },
        { options: ["-region", "1x1+1+0", "-shear", "0x5", "+region"], format: "rgba", hex: "ff0000fffff4f4ffff0b0bffff2121ffff0b0bffff0000ff" },
        { options: ["-region", "1x1+1+0", "-shear", "10x0"], format: "rgba", hex: "ff2d2d00ffd2d200ff2d2d00ff000000ff000000ff000000" },
        { options: ["-region", "1x1+1+0", "-shear", "10x0", "+region"], format: "PNG32", hex: horizontal },
        { options: ["-region", "1x1+1+0", "-shear", "10x0"], format: "PNG32", hex: horizontal },
        { options: ["-shear", "10x0"], format: "rgba", hex: "ff2d2dffff0000ffff0000ffff0000ffff0000ffff0000ff" },
        { options: ["-region", "1x1+1+0", "+region", "-shear", "0x5"], format: "rgba", hex: "ff0000ffff0000ffff0b0bffff2121ffff0b0bffff0000ff" }
    ])(`${mode}: $options $format`, async ({ options, format, hex }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        const argv = ["-size", "3x2", "xc:red", ...options, "-depth", "8", `${format}:${mode === "stdout" ? "-" : "/out"}`];
        let stderr = "";
        const result = mode === "command" || mode === "stdout" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const bytes = mode === "stdout" ? Buffer.concat(stdout) : mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(format === "PNG32" ? decodeImage(bytes).data : bytes).toString("hex")).toBe(hex);
    });
}
