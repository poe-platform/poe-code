import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["xc:red", "canvas:red"])(`exposes inline thumbnail source properties to formatting and operators: %s (${mode})`, async input => {
        const format = "%[Thumb::Image::Width]|%[Thumb::Image::Height]|%[Thumb::Document::Pages]|%[Thumb::URI]";
        const args = ["-size", "3x2", input, "-thumbnail", "2x1", "-set", "label", format, "-format", `${format}|%[label]|%[thumb::image::width]`, "info:-"];
        const filesystem = new MemoryFileSystem();
        let stdout = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
        }
        expect(stdout).toBe("3|2|1|./red|3|2|1|./red|3");
    });
}
