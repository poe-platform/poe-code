import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const evaluate of [false, true]) {
        it.each([
            { compose: "Over", channel: "A", pixel: "208040b0" },
            { compose: "Over", channel: "R", pixel: "37804060" },
            { compose: "Over", channel: "", pixel: "37809db0" },
            { compose: "Copy", channel: "A", pixel: "20804080" },
            { compose: "Copy", channel: "R", pixel: "40804060" },
            { compose: "Copy", channel: "", pixel: "4080c080" },
        ])(`${mode}: extent $compose selects $channel (evaluate=${evaluate})`, async ({ compose, channel, pixel }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", files.get("/out")!);
            const args = ["-size", "4x3", "xc:#4080c080", ...(evaluate ? ["-evaluate", "Add", "0"] : []),
                "-background", "#20804060", "-compose", compose, ...(channel ? ["-channel", channel] : []),
                "-extent", "6x5", "+channel", "+repage", "-depth", "8", "-write", "rgba:/canvas",
                "-crop", "1x1+0+0", "rgba:/out"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(pixel);
            const canvas = mode === "command" || mode === "retained" ? await filesystem.readFile("/canvas") : files.get("/canvas")!;
            expect(Buffer.from(canvas).toString("hex")).toBe(Array.from({ length: 30 }, (_, i) =>
                i % 6 < 4 && Math.floor(i / 6) < 3 ? pixel : "20804060").join(""));
        });
    }
}
