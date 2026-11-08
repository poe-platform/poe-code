import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: xc:'#123456' xc:'#abcdef' +append -strip PNG24:-
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12MQMglbffY9AAdZAwSpAg/NAAAAAElFTkSuQmCC"), c => c.charCodeAt(0));
const png16 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MQEjIxCQtbvfrs2ffvARpSBgfYzjl+AAAAAElFTkSuQmCC"), c => c.charCodeAt(0));
const cases = [
    ["HSL", "(149,167,52)  #95A734", "(38229,42850,13364)  #9555A7623434"],
    ["HSB", "(149,202,86)  #95CA56", "(38229,51818,22102)  #9555CA6A5656"],
    ["HWB", "(149,18,169)  #9512A9", "(38229,4626,43433)  #95551212A9A9"],
    ["XYZ", "(8,8,24)  #080818", "(2069,2134,6073)  #0815085617B9"],
];

for (const mode of ["sync", "buffered", "command"]) {
    it.each(cases)(`${mode} TXT respects source depth and explicit depth in %s`, async (space, low, high) => {
        for (const { source, depth } of [
            ...[undefined, 8, 16].map(depth => ({ source: png, depth })),
            ...[undefined, 8, 16].map(depth => ({ source: png16, depth })),
        ]) {
            const highDepth = depth === 16 || (depth === undefined && source === png16);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", source.slice());
            const files = new Map([["in.png", source.slice()]]);
            const args = ["in.png", "-colorspace", space!, ...(depth ? ["-depth", String(depth)] : []), "txt:-"];
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            const output = "stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout;
            expect(output.split("\n")[0]).toBe(`# ImageMagick pixel enumeration: 2,1,0,${highDepth ? 65535 : 255},${space!.toLowerCase()}`);
            expect(output).toContain(`0,0: ${highDepth ? high : low}  `);
        }
    });
}
