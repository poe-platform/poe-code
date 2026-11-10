import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI output for the 3×2 PAM below.
const translucent = "2040807720408077204080772040807720408077204080770f3565bc4668a28b4a729de32040807720408077a32a5bb231528f81375e8bd8204080772040807720408077204080772040807720408077";
const defaultBorder = "dfdfdfffdfdfdfffdfdfdfffdfdfdfffdfdfdfffdfdfdfff71869bffd7dde3ff6d8daeffdfdfdfffdfdfdfffe88b9dffdadde0ff6a87a4ffdfdfdfffdfdfdfffdfdfdfffdfdfdfffdfdfdfffdfdfdfff";

for (const mode of ["command", "map"] as const) {
    it.each([
        { name: "reset after reading", input: ["im.pam", "-bordercolor", "#20408077", "+bordercolor"], expected: translucent },
        { name: "reset before reading", input: ["-bordercolor", "#20408077", "+bordercolor", "im.pam"], expected: defaultBorder },
        { name: "repeated reset after reading", input: ["-bordercolor", "#20408077", "im.pam", "+bordercolor", "+bordercolor"], expected: translucent },
        { name: "assignment after reset", input: ["im.pam", "-bordercolor", "red", "+bordercolor", "-bordercolor", "#20408077"], expected: translucent },
        { name: "assigned color", input: ["im.pam", "-bordercolor", "#20408077"], expected: translucent },
        { name: "default color", input: ["im.pam"], expected: defaultBorder },
    ])(`${mode}: $name`, async ({ input, expected }) => {
        const bytes = new Uint8Array([...new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            ...Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256)]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/im.pam", bytes);
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const files = new Map([["im.pam", bytes], ["out", new TextEncoder().encode("KEEP")]]);
        const args = createCommandArguments([...input, "-border", "1", "-depth", "8", "rgba:out"]);
        let stderr = "";
        const result = mode === "map" ? await runMagickCli(args.args, files).then(result => { stderr = result.stderr; return result; })
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.from(mode === "map" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
    });
}
