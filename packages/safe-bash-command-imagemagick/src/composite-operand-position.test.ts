import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI output for the same PPM inputs.
const cases = [
    { operation: [], between: "0a6f79288d9746abb5", both: "0a6f79288d9746abb5" },
    { operation: ["-negate"], between: "0a908628726846544a", both: "f59086d77268b9544a" },
    { operation: ["-rotate", "180"], between: "0aabb5288d97466f79", both: "46abb5288d970a6f79" },
];

for (const route of ["command", "buffered", "sync"])
for (const placement of ["before", "between", "after"])
for (const { operation, between, both } of cases)
it(`${route}: composite ${operation.join(" ") || "defaults"} ${placement} inputs`, async () => {
    const hex = placement === "between" ? between : both;
    const files = new Map([
        ["/left.ppm", Buffer.from("P3\n3 1\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["/right.ppm", Buffer.from("P3\n3 1\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["/out.raw", Buffer.from("KEEP")],
        ["/side.raw", Buffer.from("KEEP")],
    ]);
    const inputs = ["/left.ppm", "/right.ppm"];
    inputs.splice(placement === "before" ? 0 : placement === "between" ? 1 : 2, 0, ...operation);
    const args = ["-compose", "CopyRed", ...inputs, "rgb:/out.raw"];
    if (route === "command") {
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["composite", ...args]).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(await fs.readFile("/out.raw")).toString("hex")).toBe(hex);
        expect(Buffer.from(await fs.readFile("/side.raw")).toString()).toBe("KEEP");
    } else {
        const result = route === "sync" ? runCompositeCliSync(args, files) : await runCompositeCli(args, files);
        expect({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(files.get("/out.raw")!).toString("hex")).toBe(hex);
        expect(Buffer.from(files.get("/side.raw")!).toString()).toBe("KEEP");
    }
});
