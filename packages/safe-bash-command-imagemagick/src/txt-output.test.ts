import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick: -size 2x1 -depth 8 rgba:- -strip PNG32:-
// Input bytes: 12 34 56 80 ab cd ef 40.
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12MQMglrWH32vQMADboDxJrreZsAAAAASUVORK5CYII="), char => char.charCodeAt(0));

it.each([false, true].flatMap(retained =>
    ["pixels.txt", "pixels.TXT", "txt:pixels.bin", "txt:-", "png:pixels.txt"].map(output => ({ retained, output }))
))("selects pixel enumeration for $output retained=$retained", async ({ retained, output }) => {
    const fs = new MemoryFileSystem(), files = new Map([["input.png", png]]);
    await fs.writeFile("/input.png", png);
    const result = await runConvertCli(["input.png", output], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const path = output.includes(":") ? output.slice(output.indexOf(":") + 1) : output;
    const bytes = path === "-" ? new TextEncoder().encode(result.stdout) : retained ? await fs.readFile(`/${path}`) : files.get(path)!;
    if (output.startsWith("png:")) {
        expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        return;
    }
    // Exact native Q16 TXT bytes, including offset and six-significant-digit alpha.
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(
        "# ImageMagick pixel enumeration: 2,1,0,255,srgba\n" +
        "0,0: (18,52,86,128)  #12345680  srgba(18,52,86,0.501961)\n" +
        "1,0: (171,205,239,64)  #ABCDEF40  srgba(171,205,239,0.25098)\n"
    );
});
