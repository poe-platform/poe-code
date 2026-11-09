import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, PNG32 output decoded to 8-bit RGBA.
const cases = [
    {
        "name": "default",
        "args": [
            "-channel",
            "Default"
        ],
        "rgba": "IjqOLFRNnyw4Xa8sYUW9LEhWjSwnPZ4sVlCtLDw0vCxjSIssS1mcLCxBrCxZUrssPziJLGVLmixOXKosMES5LFxVhyxCPJksaE6pLFFeuCw0R4UsXliXLEU/pywiUbYsVDbELDhKlSxhWqYsSEK1LCdUwyxWOpQsPE2kLGNdsyxLRcLxLFaS8Vk9ovE/ULLxZTTA8U5IkPEwWaHxXEGw8UJSv/FoOI7xUUuf8TRcr/FeRL3xRVWN8SI8nvFUTq3xOF688WFHi/FIWJzxJz+s8VZRu/E8NonxY0qa8UtaqvEsQrnxWVSH8T86mfFlTanxTl248TBFhfFcVpfxQj2n8Q=="
    },
    {
        "name": "implicit",
        "args": [],
        "rgba": "IjqOLFRNnyw4Xa8sYUW9LEhWjSwnPZ4sVlCtLDw0vCxjSIssS1mcLCxBrCxZUrssPziJLGVLmixOXKosMES5LFxVhyxCPJksaE6pLFFeuCw0R4UsXliXLEU/pywiUbYsVDbELDhKlSxhWqYsSEK1LCdUwyxWOpQsPE2kLGNdsyxLRcLxLFaS8Vk9ovE/ULLxZTTA8U5IkPEwWaHxXEGw8UJSv/FoOI7xUUuf8TRcr/FeRL3xRVWN8SI8nvFUTq3xOF688WFHi/FIWJzxJz+s8VZRu/E8NonxY0qa8UtaqvEsQrnxWVSH8T86mfFlTanxTl248TBFhfFcVpfxQj2n8Q=="
    },
    {
        "name": "reset",
        "args": [
            "-channel",
            "Default",
            "+channel"
        ],
        "rgba": "IjqOLFRNnyw4Xa8sYUW9LEhWjSwnPZ4sVlCtLDw0vCxjSIssS1mcLCxBrCxZUrssPziJLGVLmixOXKosMES5LFxVhyxCPJksaE6pLFFeuCw0R4UsXliXLEU/pywiUbYsVDbELDhKlSxhWqYsSEK1LCdUwyxWOpQsPE2kLGNdsyxLRcLxLFaS8Vk9ovE/ULLxZTTA8U5IkPEwWaHxXEGw8UJSv/FoOI7xUUuf8TRcr/FeRL3xRVWN8SI8nvFUTq3xOF688WFHi/FIWJzxJz+s8VZRu/E8NonxY0qa8UtaqvEsQrnxWVSH8T86mfFlTanxTl248TBFhfFcVpfxQj2n8Q=="
    },
    {
        "name": "RGB",
        "args": [
            "-channel",
            "RGB"
        ],
        "rgba": "Um5kC4iBeAtskIsLk3qeC32KYgtYcXYLioSJC3BnnAuVfWALgIx0C151hwuNhpsLdGxeC5eAcguDjoULY3iZC4+JXAt3b3ALmYKEC4WRlwtoe1oLkYtuC3pzggtShZULiGqoC2x+bAuTjYALfXaTC1iHpguKbmoLcIF+C5WQkQuAeqTmXopo5o1xfOZ0hI/ml2ei5oN9ZuZjjHrmj3WN5neGoOaZbGTmhYB45miOi+aReJ7meoli5lJvduaIgonmbJGc5pN7YOZ9i3TmWHOH5oqFm+Zwal7mlX5y5oCNheZedpnmjYdc5nRucOaXgYTmg5CX5mN6WuaPim7md3GC5g=="
    }
];
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each(cases)(`matches native auto-gamma $name channels including alpha via ${mode}`, async ({ args: channels, rgba }) => {
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MTQ6MzcrMDA6MDDu+JGtAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjE0OjM3KzAwOjAwn6UpEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzoxNDozNyswMDowMMiwCM4AAABrSURBVBjTdc7BCYAwDAXQbxAkmJPk2AE6jQM4rmu4QknvIQcPYiuip8D7fPKHadnmJAoTRaoKkx1WFUkUVhWUOeAc8NJvMw7QFz4L5GV94drCzIHROY4WSiCXgEkvkPOF/vviA5+b6G/9bSf+oICXc0KZiQAAAABJRU5ErkJggg==", "base64");
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...channels, "-auto-gamma", "PNG32:out.png"];
        let exitCode: number;
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.stderr).toBe("");
            exitCode = result.exitCode;
        }
        expect(exitCode).toBe(0);
        const actual = decodeImage(mode === "retained" || mode === "public" ? await filesystem.readFile("/out.png") : files.get("out.png")!).data;
        expect(Buffer.from(actual).toString("base64")).toBe(rgba);
    });
}
