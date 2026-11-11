import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: flood fill paints in the working colorspace.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const connected of [false, true]) it.each([
        { space: "Gray", expected: "cf468380" },
        { space: "RGB", expected: "e98fbe80" },
        { space: "sRGB", expected: "cf468380" }
    ])(`${mode}: color floodfill paints its $space seed (connected=${connected})`, async ({ space, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const input = Buffer.from("34a05cff34a05cffffffffff34a05cff", "hex");
        files.set("in", input);
        await fs.writeFile("/in", input);
        const argv = [...(connected ? ["-size", "4x1", "-depth", "8", "rgba:in"] : ["xc:#34a05c"]),
            "-colorspace", space, "-fill", "#cf468380",
            "-draw", "color 0,0 floodfill", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(connected
            ? expected + expected + "ffffffff" + (space === "Gray" ? "848484ff" : "34a05cff") : expected);
    });
}
