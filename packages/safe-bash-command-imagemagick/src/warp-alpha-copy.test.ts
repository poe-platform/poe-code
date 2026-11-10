import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: copied intensity is 0x4b; enabled alpha is 0x60.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const alpha of ["Copy", "On"]) {
        for (const extraction of [["-alpha", "extract"], ["-channel", "A", "-separate", "+channel"]]) {
            it.each([[], ["-swirl", "0"], ["-implode", "0"], ["-swirl", "105"], ["-implode", "1.25"]]
                .flatMap(warp => [1, 3].map(size => ({ warp, size }))))(
                `${mode}: alpha ${alpha} survives $warp at $size x $size before ${extraction.join(" ")}`,
                async ({ warp, size }) => {
                    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
                    const filesystem = new MemoryFileSystem();
                    await filesystem.writeFile("/out", files.get("/out")!);
                    const args = ["-size", `${size}x${size}`, "xc:#80402060", "-alpha", alpha, ...warp, ...extraction, "-depth", "8", "gray:/out"];
                    let stderr = "";
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    }) : mode === "sync" ? runConvertCliSync(args, files)
                        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                    expect(result, stderr).toMatchObject({ exitCode: 0 });
                    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                    expect([...output]).toEqual(Array(size * size).fill(alpha === "Copy" ? 0x4b : 0x60));
                }
            );
        }
    }
}
