import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: xc:'#123456' xc:'#abcdef' +append -strip PNG24:-
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12MQMglbffY9AAdZAwSpAg/NAAAAAElFTkSuQmCC"), c => c.charCodeAt(0));
for (const mode of ["sync", "buffered", "command"]) {
    it(`${mode} HSL TXT annotations preserve unrounded samples`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", png.slice());
        const args = ["in.png", "-colorspace", "HSL", "-depth", "16", "txt:-"];
        let stdout = "", stderr = "";
        const files = new Map([["in.png", png.slice()]]);
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(
            "# ImageMagick pixel enumeration: 2,1,0,65535,hsl\n" +
            "0,0: (38229,42850,13364)  #9555A7623434  hsl(210,65.3846%,20.3922%)\n" +
            "1,0: (38229,44564,52685)  #9555AE14CDCD  hsl(210,68%,80.3922%)\n"
        );
    });
}
