import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: first of two intermediates; at least one input keeps its dimensions.
const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from([
    12, 27, 40, 51, 60, 71, 81, 90, 100, 115, 135, 145, 160, 179, 190, 201, 220, 239,
])]);

describe.each(["command", "retained", "buffered", "sync"] as const)("unchanged-size morph (%s)", mode => {
    for (const resized of [false, true])
    it.each([
        { filter: "Mitchell", resizedExpected: "5b61656a6e71777a7e82898d949b9fa5acb3", expected: "5c6165686b6f7275787a8184888e92959ba1" },
        { filter: "Gaussian", resizedExpected: "5f64686d7174797c8080878b91989ca0a7ae", expected: "5f64686a6e7174777b797f83868c9092989d" },
        { filter: "Cubic", resizedExpected: "646a6e7175797d81857e85888d93989ba1a7", expected: "63686c6d7175767a7d777e8183898d8d9398" },
        { filter: "Point", resizedExpected: "595e6266696d7073767b82858a9194989ea5", expected: "595e6266696d7073767b82858a9194989ea5" },
        { filter: "", resizedExpected: "585e62686c6f75797c848b8e979ea2a9b1b8", expected: "595e6266696d7073767b82858a9194989ea5" },
    ])(`applies $filter before blending (second resized=${resized})`, async ({ filter, expected, resizedExpected }) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "(", "/in.ppm", ...(resized ? ["-sample", "4x3!"] : []), "-negate", ")", ...(filter ? ["-filter", filter] : []), "-morph", "2", "-delete", "0,2,3", "-depth", "8", "rgb:-"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(resized ? resizedExpected : expected);
    });
});
