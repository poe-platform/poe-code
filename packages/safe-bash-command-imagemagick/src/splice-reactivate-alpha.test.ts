import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        { alpha: ["-alpha", "off"], background: "none", pixel: [0, 0, 0, 0] },
        { alpha: ["-alpha", "off"], background: "#12345680", pixel: [18, 52, 86, 128] },
        { alpha: [], background: "none", pixel: [0, 0, 0, 0] },
        { alpha: ["-alpha", "opaque"], background: "none", pixel: [0, 0, 0, 0] },
        { alpha: ["-alpha", "off"], background: "red", pixel: [255, 0, 0, 255] }
    ])(`keeps existing pixels opaque when splice reactivates alpha (${mode}): %j`, async ({ alpha, background, pixel }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("out")!);
        const args = ["xc:red", ...alpha, "-background", background, "-splice", "1x0+1+0", "-depth", "8", "rgba:out"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const diagnostics: string[] = [];
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(data) { diagnostics.push(new TextDecoder().decode(data)); } } });
            expect(result.exitCode).toBe(0);
            expect(diagnostics.join("")).toBe("");
        } else {
            const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
        const bytes = mode === "buffered" ? files.get("out")! : await filesystem.readFile("/out");
        expect(bytes).toEqual(Uint8Array.from([255, 0, 0, 255, ...pixel]));
    });
}
