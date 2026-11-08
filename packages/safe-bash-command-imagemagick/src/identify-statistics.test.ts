import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";
import fixtures from "./identify-statistics-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2 Q16-HDRI, identical encoded inputs. Allow rounding and tiny
// floating-point residuals in otherwise zero skewness.
it.each(fixtures)("reports native verbose statistics for $name through every route", async ({ png, statistics }) => {
    const bytes = Buffer.from(png, "base64"), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const verify = (stdout: string) => {
        const start = stdout.indexOf("  Channel statistics:\n");
        expect(start).toBeGreaterThanOrEqual(0);
        const actual = stdout.slice(start).split("\n"), expected = statistics.trimEnd().split("\n");
        for (let i = 0; i < expected.length; i++) {
            const line = expected[i]!, colon = line.indexOf(":");
            expect(actual[i]?.slice(0, colon + 1)).toBe(line.slice(0, colon + 1));
            const numbers = (value: string) => value.slice(colon + 1).replaceAll("(", " ").replaceAll(")", " ").split(" ").filter(Boolean).map(Number);
            const values = numbers(actual[i]!);
            expect(values).toHaveLength(numbers(line).length);
            numbers(line).forEach((value, j) => expect(Math.abs(values[j]! - value)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(value) * 1e-5)));
        }
    };
    for (const moments of [[], ["-moments"]]) {
        const args = [...moments, "-verbose", "/input.png"];
        verify(runIdentifyCliSync(args, new Map([["/input.png", bytes]])).stdout);
        for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
            const result = await runIdentifyCli(args, input);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            verify(result.stdout);
        }
        const argumentValues = createCommandArguments(["identify", ...args]);
        let stdout = "";
        const result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
        expect(result.exitCode).toBe(0);
        verify(stdout);
    }
    expect(await fs.readFile("/input.png")).toEqual(new Uint8Array(bytes));
});

it("honors verbose precision without changing formatted or ordinary identify output", async () => {
    const bytes = Buffer.from(fixtures[0]!.png, "base64"), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
        expect((await runIdentifyCli(["-precision", "3", "-verbose", "/input.png"], input)).stdout).toContain("      mean: 4.61e+03 (0.0703)\n");
        expect((await runIdentifyCli(["-verbose", "-format", "%w", "/input.png"], input)).stdout).toBe("2");
        expect((await runIdentifyCli(["/input.png"], input)).stdout).not.toContain("statistics:");
    }
});
