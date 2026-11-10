import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./signature-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2 Q16-HDRI PNGs and pixel signatures. Plain/tagged
// differ only in comment/page metadata; changed differs by one red pixel.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const output of ["identify", "info"] as const)
it.each(fixtures)(`${mode} ${output}: expands native pixel signatures for $name`, async ({ png, signature }) => {
    const input = Buffer.from(png, "base64");
    const files = new Map([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    if (mode === "retained" || mode === "command") await filesystem.writeFile("/in.png", input);
    const format = "%#|%[signature]|%[SIGNATURE]|%%#|%%[signature]";
    const args = output === "identify" ? ["identify", "-format", format, "/in.png"] : ["/in.png", "-format", format, "info:"];
    if (mode === "command") {
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const decoder = new TextDecoder();
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += decoder.decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += decoder.decode(bytes); } }
        } as CommandContext);
        expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stderr: "", stdout: `${signature}|${signature}|${signature}|%#|%[signature]` });
        return;
    }
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: `${signature}|${signature}|${signature}|%#|%[signature]` });
});
