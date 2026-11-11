import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";
import fixtures from "./identify-intent-fixtures.json" with { type: "json" };

// Encoded inputs and expected intents from ImageMagick 7.1.2-35 Q16-HDRI.
it.each(fixtures)("reports the stored rendering intent for $name through every route", async fixture => {
    const bytes = Buffer.from(fixture.bytes, "base64"), path = `/input.${fixture.format}`;
    const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const args = ["-verbose", path];
    const verify = (result: { exitCode: number; stdout: string; stderr: string }) => {
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("  Geometry: 3x2+0+0\n");
        expect(result.stdout.split("\n").filter(line => line.startsWith("  Rendering intent:"))).toEqual([`  Rendering intent: ${fixture.intent}`]);
    };
    verify(runIdentifyCliSync(args, files));
    verify(await runIdentifyCli(args, files));
    verify(await runIdentifyCli(args, { filesystem: fs, cwd: "/" }));
    for (const command of [createIdentifyCommand(), createMagickCommand()]) {
        const argumentValues = createCommandArguments(command.name === "magick" ? ["identify", ...args] : args);
        let stdout = "", stderr = "";
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        verify({ ...result, stdout, stderr });
    }
    expect(await fs.readFile(path)).toEqual(new Uint8Array(bytes));
});

it("keeps rendering intent out of ordinary and custom identify output", async () => {
    const bytes = Buffer.from(fixtures[1]!.bytes, "base64"), files = new Map([["/relative.bmp", bytes]]);
    expect((await runIdentifyCli(["/relative.bmp"], files)).stdout).not.toContain("Rendering intent:");
    expect(await runIdentifyCli(["-verbose", "-format", "%m %wx%h", "/relative.bmp"], files)).toEqual({ exitCode: 0, stdout: "BMP 3x2", stderr: "" });
});
