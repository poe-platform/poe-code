import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI; padding retains the original background samples.
for (const route of ["command", "retained", "buffered", "sync"] as const) {
    for (const explicitDepth of [false, true]) {
        it.each([
            { compose: "DstIn", pixel: "bdbd353556563f7e" },
            { compose: "SrcIn", pixel: "0778295530ce3f7e" },
            { compose: "Blend", pixel: "6458757a9509ffff" },
            { compose: "Dissolve", pixel: "467d89f5a8d6c182" },
            { compose: "Mathematics", pixel: "3c9c53466845c182" },
            { compose: "Over", pixel: "467d89f5a8d6c182" },
        ])(`${route}: extent $compose preserves fractions (explicit depth=${explicitDepth})`, async ({ compose, pixel }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["xc:#1ea6c490", ...(explicitDepth ? ["-depth", "16"] : []),
                "-background", "#bd355670", "-compose", compose, "-gravity", "East", "-extent", "3x1",
                "-depth", "16", "-endian", "MSB", "-write", "rgba:/precise",
                "-channel", "A", "-threshold", "24.75%", "+channel", "-depth", "8", "rgba:/threshold"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = route === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : route === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stderr: "" });
            const precise = route === "command" || route === "retained" ? await filesystem.readFile("/precise") : files.get("/precise")!;
            expect(Buffer.from(precise).toString("hex")).toBe("bdbd353556567070".repeat(2) + pixel);
            const threshold = route === "command" || route === "retained" ? await filesystem.readFile("/threshold") : files.get("/threshold")!;
            expect([threshold[3], threshold[7], threshold[11]]).toEqual([255, 255, 255]);
        });
    }
}
