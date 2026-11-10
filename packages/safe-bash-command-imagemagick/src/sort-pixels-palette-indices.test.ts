import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: slots 0 and 2 share RGB, but keep their identities.
const fixtures = [
    {
        name: "opaque duplicates",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABAgMAAACEUudeAAAADFBMVEW0eDIeKDK0eDIAyIDny/TkAAAACklEQVR4nGNoAwAAiACHFa0g+wAAAABJRU5ErkJggg==",
        original: "b47832ffb47832ff1e2832ffb47832ff",
        cycled: "00c880ff1e2832ffb47832ff00c880ff",
        sorted: "1e2832ffb47832ffb47832ffb47832ff",
        sortedCycle: "b47832ff00c880ff1e2832ff00c880ff",
    },
    {
        name: "distinct alpha slots",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABAgMAAACEUudeAAAADFBMVEW0eDIeKDK0eDIAyIDny/TkAAAABHRSTlP/gEDmNbNzowAAAApJREFUeJxjaAMAAIgAhxWtIPsAAAAASUVORK5CYII=",
        original: "b4783240b47832ff1e283280b4783240",
        cycled: "00c880e61e283280b478324000c880e6",
        sorted: "1e283280b4783240b47832ffb4783240",
        sortedCycle: "b478324000c880e61e28328000c880e6",
    },
];

// Packed indices cross 512-pixel reads and start each of three rows at a different slot.
const colors = ["ff0000ff", "00ff0080", "ff0000ff", "0000ff00"];
const rows = Array.from({ length: 3 }, (_, y) => Array.from({ length: 1031 }, (_, x) => (x + y) % 4));
const sortedRows = rows.map(row => [row.filter(index => index === 3),
    row.filter(index => index === 0 || index === 2), row.filter(index => index === 1)].flat());
fixtures.push({
    name: "duplicate slots across chunks and scanlines",
    png: "iVBORw0KGgoAAAANSUhEUgAABAcAAAADAgMAAACSdI7UAAAADFBMVEX/AAAA/wD/AAAAAP/sfQRUAAAABHRSTlP/gP8AH4eGmQAAABdJREFUeJxjkB7pQIIhZ8QDho0jHWwAAE1jOnxDdRcuAAAAAElFTkSuQmCC",
    original: rows.flat().map(index => colors[index]).join(""),
    cycled: rows.flat().map(index => colors[(index + 1) % 4]).join(""),
    sorted: sortedRows.flat().map(index => colors[index]).join(""),
    sortedCycle: sortedRows.flat().map(index => colors[(index + 1) % 4]).join(""),
});

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const fixture of fixtures) {
        it.each([
            { operations: [], expected: fixture.original },
            { operations: ["-cycle", "1"], expected: fixture.cycled },
            { operations: ["-sort-pixels"], expected: fixture.sorted },
            { operations: ["-sort-pixels", "-cycle", "1"], expected: fixture.sortedCycle },
            { operations: ["-sort-pixels", "-cycle", "1", "-cycle", "-1"], expected: fixture.sorted },
        ])(`${mode}: preserves ${fixture.name} for $operations`, async ({ operations, expected }) => {
            const input = Uint8Array.from(Buffer.from(fixture.png, "base64"));
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["in.png", ...operations, "-depth", "8", "rgba:out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
