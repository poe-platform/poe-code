import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const components = ["303030", "606060", "202020", "101010"].map(color => [
    "(", "xc:black", "-duplicate", "3", `xc:#${color}`, "-combine", ")",
]);
const inputs = components.flat();

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "Add Meta0", operation: "Add", expected: "5070" },
        { name: "Subtract Meta0", operation: "Subtract", expected: "1050" },
        { name: "Multiply Meta0", operation: "Multiply", expected: "000f" },
        { name: "Add red control", operation: "Add", channel: "R", expected: "0000" },
        { name: "Subtract red control", operation: "Subtract", channel: "R", expected: "0000" },
        { name: "second meta channel", operation: "Add", channel: "Meta1", expected: "5070", frames:
            components.flatMap(frame => [...frame.slice(0, -2), frame[4]!, ...frame.slice(-2)]) },
        { name: "two-input self addition", operation: "Add", expected: "60c0", frames: components.slice(0, 2).flat() },
        { name: "missing channel in fourth component", operation: "Add", expected: "3060", frames: [...components.slice(0, 3).flat(), "xc:black"] },
        { name: "conjugate negative samples round trip", operation: "Conjugate", after: ["-complex", "Conjugate"], expected: "3060" },
        { name: "polar round trip", operation: "MagnitudePhase", after: ["-complex", "RealImaginary"], expected: "3060" },
        { name: "division", operation: "Divide", expected: "ffff" },
        { name: "chunks and rows", operation: "Add", size: "1025x2", expected: ("50".repeat(1025) + "70".repeat(1025)).repeat(2) },
        { name: "16-bit samples", operation: "Add", depth: "16", expected: "12361113", frames:
            ["1234", "1111", "0002", "0002"].flatMap(value => ["(", "xc:black", "-duplicate", "3", `xc:#${value.repeat(3)}`, "-combine", ")"]) },
        { name: "preserve real tail", operation: "Add", expected: "503070", frames:
            components.flatMap((frame, index) => ["(", "-size", index === 0 ? "2x1" : "1x1", ...frame, ")"]) },
        { name: "extend smaller second pair", operation: "Add", expected: "50507070", frames:
            components.flatMap((frame, index) => ["(", "-size", index < 2 ? "2x1" : "1x1", ...frame, ")"]) },
        { name: "destination write mask", operation: "Add", expected: "3070", frames:
            ["(", ...components[0]!, "-write-mask", "xc:white", ")", ...components.slice(1).flat()], after: ["+write-mask"] },
    ])(`${mode}: complex $name`, async ({ operation, expected, channel = "Meta0", frames = inputs, after = [], size = "1x1", depth = "8" }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = ["-size", size, ...frames, "-complex", operation, ...after, "-channel", channel, "-separate", "+channel", "+append", "-depth", depth, "-endian", "MSB", "gray:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
