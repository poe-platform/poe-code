import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

for (const [label, pixels, expected] of [
    ["reported ink", [255, 255, 255, 10, 255, 255, 255, 50, 255, 255, 255, 10, 255, 255, 255, 200], ["1", "1", "1", "0.0392157"]],
    ["distinct inks", [51, 102, 153, 204], ["0.2", "0.4", "0.6", "0.8"]],
] as const) {
    it.each(["c", "m", "y", "r", "g", "b", "k"])(`${label}: evaluates u.%s through the public command`, async qualifier => {
        const filesystem = new MemoryFileSystem();
        const header = new TextEncoder().encode(`P7\nWIDTH ${pixels.length / 4}\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n`);
        await filesystem.writeFile("/ink.pam", Uint8Array.from([...header, ...pixels]));
        await filesystem.writeFile("/out", new TextEncoder().encode("KEEP"));
        const argumentValues = createCommandArguments(["ink.pam", "-format", `%[fx:u.${qualifier}]`, "info:out"]);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), registerCleanup() {},
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const channel = qualifier === "k" ? 3 : ["cr", "mg", "yb"].findIndex(aliases => aliases.includes(qualifier));
        expect(new TextDecoder().decode(await filesystem.readFile("/out"))).toBe(expected[channel]);
    });
}
