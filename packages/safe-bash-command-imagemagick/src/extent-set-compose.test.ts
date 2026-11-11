import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, exact 6x5 RGB output from the same PPM bytes.
const hashes = {
    over: "c41913cf7a765341ac29865ab9c97ebf2cc87d5870fdbe715d50f7158d697935",
    copyRed: "f8090cbcd29096fcdfe4e22f5ce2b00bd8b25a2ff1c188551ef11fcdf9011f34"
};

describe.each(["command", "sync", "buffered", "retained"] as const)("extent compose settings (%s)", mode => {
    it.each([
        { options: [], expected: hashes.over },
        { options: ["-compose", "CopyRed"], expected: hashes.copyRed },
        { options: ["-set", "compose", "CopyRed"], expected: hashes.copyRed },
        { options: ["-set", "option:compose", "CopyRed"], expected: hashes.copyRed },
        { options: ["-compose", "Over", "-set", "compose", "CopyRed"], expected: hashes.over },
        { options: ["-set", "compose", "CopyRed", "-compose", "Over"], expected: hashes.over },
        { options: ["-compose", "Over", "-set", "option:compose", "CopyRed"], expected: hashes.copyRed },
        { options: ["-set", "option:compose", "CopyRed", "-compose", "Over"], expected: hashes.over },
        { options: ["-set", "compose", "CopyRed", "+set", "compose"], expected: hashes.copyRed },
        { options: ["-set", "compose", "CopyRed", "+compose"], expected: hashes.over }
    ])("uses $options", async ({ options, expected }) => {
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i))]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...options, "-background", "orange", "-extent", "6x5+0+0", "-depth", "8", "rgb:/out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(90);
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
});
