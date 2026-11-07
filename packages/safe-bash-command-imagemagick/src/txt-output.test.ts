import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick: -size 2x1 -depth 8 rgba:- -strip PNG32:-
// Input bytes: 12 34 56 80 ab cd ef 40.
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12MQMglrWH32vQMADboDxJrreZsAAAAASUVORK5CYII="), char => char.charCodeAt(0));

const gray16 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAAAAABuG5crAAAAD0lEQVR4nGMQMhEy/f8fAAVbAoy6VK0cAAAAAElFTkSuQmCC"), char => char.charCodeAt(0));

it.each([false, true])("preserves low-order grayscale samples retained=%s", async retained => {
    const filesystem = new MemoryFileSystem(), files = new Map([["gray.png", gray16]]);
    await filesystem.writeFile("/gray.png", gray16);
    const input = retained ? { filesystem, cwd: "/" } : files;
    const expected = "# ImageMagick pixel enumeration: 3,1,0,65535,gray\n" +
        "0,0: (4660)  #123412341234  gray(7.1107%)\n" +
        "1,0: (4661)  #123512351235  gray(7.11223%)\n" +
        "2,0: (65535)  #FFFFFFFFFFFF  gray(255)\n";
    expect(await runConvertCli(["gray.png", "txt:-"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    const graya = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAQAAADheQB8AAAAEklEQVR4nGMQMvn/X8j0PxgAACz8CIZHxIz2AAAAAElFTkSuQmCC"), char => char.charCodeAt(0));
    files.set("graya.png", graya);
    await filesystem.writeFile("/graya.png", graya);
    const alpha = await runConvertCli(["graya.png", "txt:-"], input);
    expect(alpha).toEqual({ exitCode: 0, stderr: "", stdout:
        "# ImageMagick pixel enumeration: 3,1,0,65535,graya\n" +
        "0,0: (4660,65535)  #123412341234FFFF  graya(7.1107%,1)\n" +
        "1,0: (4661,65535)  #123512351235FFFF  graya(7.11223%,1)\n" +
        "2,0: (65535,65535)  #FFFFFFFFFFFFFFFF  graya(255,1)\n" });
    if (retained) {
        const chunks: Uint8Array[] = [];
        expect(await runConvertCli(["gray.png", "txt:-"], { filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes.slice()); } } })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(expected);
    }
    expect(await runConvertCli(["gray.png", "txt:out.dat"], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(retained ? await filesystem.readFile("/out.dat") : files.get("out.dat"))).toBe(expected);
});

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
