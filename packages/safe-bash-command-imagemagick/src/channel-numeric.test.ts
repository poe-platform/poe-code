import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: numeric channels 10 onward select meta planes.
const combined = [10, 20, 30, 40, 50, 60].map(percent => `xc:gray(${percent}%)`).concat("-combine");
const cases = [
    ...Array.from({ length: 27 }, (_, index) => ({
        channel: String(index + 5), input: combined, operation: "-separate", format: "gray",
        expected: index === 5 ? "80" : index === 6 ? "99" : "00",
    })),
    ...[
        ["Meta0", "80"], ["Meta1", "99"], ["4", "66"],
        ["10,11", "8099"], ["Meta0,10", "80"], ["10,!Meta0,11", "99"],
        ["Meta0,Meta1,!10", "99"], ["10|11", "8099"],
    ].map(([channel, expected]) => ({ channel: channel!, expected: expected!, input: combined, operation: "-separate", format: "gray" })),
    ...[["4", "af"], ["5", "00"], ["31", "00"]].map(([channel, expected]) => ({
        channel: channel!, expected: expected!, input: ["xc:#274d93af"], operation: "-separate", format: "gray",
    })),
    { channel: "R,5", input: ["xc:#274d93af"], operation: "-negate", format: "rgba", expected: "d84d93af" },
    ...["32", "R,32", "!32"].map(channel => ({ channel, input: combined, operation: "-separate", format: "gray", expected: undefined })),
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $channel $operation on $input`, async ({ channel, input, operation, format, expected }) => {
        const keep = Buffer.from("KEEP");
        const files = new Map([["out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = [...input, "-channel", channel, operation, "+channel", "+append", "-depth", "8", `${format}:out`];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const actual = { stdout, stderr, ...result };
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        if (expected === undefined) {
            expect(actual.exitCode).toBe(1);
            expect(actual.stderr).toContain("unrecognized channel type");
            expect(Buffer.from(bytes)).toEqual(keep);
        } else {
            expect(actual).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        }
    });
}
