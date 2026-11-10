import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including the retained write-mask channel.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const output of ["rgba", "info"] as const) it.each([
        ["active", ["-region", "1x1+0+0"], 0, "d0402000", "5.0"],
        ["full image", ["-region", "3x2+0+0"], 0, "d0402000", "5.0"],
        ["blurred", ["-region", "1x1+0+0"], 1, "d0402000", "5.0"],
        ["absent", [], 0, "d0402066", "4.0"],
        ["cleared", ["-region", "1x1+0+0", "+region"], 0, "d0402066", "4.0"],
    ] as const)(`matches shadow ${output} with %s region (${mode})`, async (_name, region, sigma, pixel, channels) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "3x2", "xc:#5080c080", ...region,
            "-background", "#d04020", "-shadow", `80x${sigma}+1+2`, "-depth", "8",
            "-format", "%wx%h %g %[channels];", `${output}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output === "rgba" ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes))
            .toBe(output === "rgba" ? pixel.repeat(sigma ? 42 : 6) : `${sigma ? "7x6 6x6-1+0" : "3x2 4x4+1+2"} srgba ${channels};`);
    });
}
