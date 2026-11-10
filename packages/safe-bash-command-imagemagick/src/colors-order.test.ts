import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects -colors without an image and preserves the destination.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "colors before the first image", before: ["+dither", "-colors", "2"], after: [], exitCode: 1, expected: "4b454550" },
        { name: "colors after the image", before: [], after: ["+dither", "-colors", "2"], exitCode: 0, expected: "a85040ff706b3bff706b3bffa85040ffa85040ff" },
        { name: "no quantization", before: [], after: [], exitCode: 0, expected: "b03010ff302010ff505080ffa07070ffd0d020ff" },
    ])(`${mode}: $name matches native status and destination bytes`, async ({ before, after, exitCode, expected }) => {
        const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = [...before, "xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append", ...after, "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(result.exitCode, stderr).toBe(exitCode);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
        if (exitCode) expect(stderr).toContain("no images found for operation '-colors'");
        else expect(stderr).toBe("");
    });
}
