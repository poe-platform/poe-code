import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) => (25 * i + 9) % 256))]);
const region = ["-region", "2x2+2+1"];
const shave = ["-shave", "1x1"];

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "moves the active region with shaved pixels", options: [...region, ...shave, "-negate", "+region"], expected: "533a21ff08efd6ff" },
        { name: "places a later region in shaved coordinates", options: [...shave, ...region, "-negate", "+region"], expected: "acc5defff71029ff" },
        { name: "clears the region after shaving", options: [...region, ...shave, "+region", "-negate"], expected: "533a21ff08efd6ff" },
        { name: "negates the shaved image without a region", options: [...shave, "-negate"], expected: "533a21ff08efd6ff" },
    ])(`$name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...options, "-crop", "2x1+1+0", "+repage", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
