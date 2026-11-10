import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI. The fifth combined plane is Meta0.
const input = ["(", "xc:#202020", "xc:#606060", "+append", ")", "-duplicate", "3",
    "(", "xc:#404040", "xc:#c0c0c0", "+append", ")", "-combine"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "unchanged control", args: [], format: "gray", expected: "40c0" },
        { name: "default", args: ["-sepia-tone", "80%"], format: "gray", expected: "26ff" },
        { name: "RGBA control", args: ["-sepia-tone", "80%"], format: "rgba", expected: "71000000fff01eaa" },
        { name: "Meta0", args: ["-channel", "Meta0", "-sepia-tone", "80%"], format: "gray", expected: "00ff" },
        { name: "explicit Default", args: ["-channel", "Default", "-sepia-tone", "80%"], format: "gray", expected: "26ff" },
        { name: "red control", args: ["-channel", "R", "-sepia-tone", "80%"], format: "gray", expected: "40c0" },
    ])(`${mode}: sepia fifth channel $name`, async ({ args, format, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [...input, ...args, "+channel", ...(format === "gray" ? ["-channel", "Meta0", "-separate", "+channel"] : []), "-depth", "8", `${format}:/out`];
        const arguments_ = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
