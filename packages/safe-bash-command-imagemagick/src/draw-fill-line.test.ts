import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGBA output.
it.each([
    {
        name: "horizontal fill-only line",
        options: ["-fill", "red"],
        draw: "line 0,0 2,0",
        expected: "ff0000ffff0000ffff0000fff31c456e97c0e9123b648db6",
    },
    {
        name: "vertical fill-only line",
        options: ["-fill", "red"],
        draw: "line 1,0 1,1",
        expected: "07305982ff0000ff4f78a1caf31c456eff0000ff3b648db6",
    },
    {
        name: "diagonal fill retains native antialiasing",
        options: ["-fill", "red"],
        draw: "line 0,0 1,1",
        expected: "ff0000ffcb829b394f78a1caf517397aff0000ff3b648db6",
    },
    {
        name: "diagonal fill with antialias disabled",
        options: ["-fill", "red", "+antialias"],
        draw: "line 0,0 1,1",
        expected: "ff0000ffabd4fd264f78a1caf31c456eff0000ff3b648db6",
    },
    {
        name: "explicit stroke retains antialiased neighbors",
        options: ["-stroke", "red"],
        draw: "line 0,0 2,0",
        expected: "ff0000ffff0000ffff0000fff5183c77ca6378214c5b81bb",
    },
    {
        name: "default fill with antialias disabled",
        options: ["+antialias"],
        draw: "line 0,0 2,0",
        expected: "000000ff000000ff000000fff31c456e97c0e9123b648db6",
    },
])("matches native destination bytes for $name", async ({ options, draw, expected }) => {
    const fs = new MemoryFileSystem();
    const header = new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
    const pixels = Uint8Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256);
    await fs.writeFile("/im.pam", new Uint8Array([...header, ...pixels]));
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const result = await createMagickCommand().execute({
        command: "magick",
        args: createCommandArguments(["im.pam", ...options, "-draw", draw, "-depth", "8", "rgba:out"]).args,
        cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(await fs.readFile("/out")).toString("hex")).toBe(expected);
});
