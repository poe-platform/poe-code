import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const color = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12MQMglrWH32vQMADboDxJrreZsAAAAASUVORK5CYII="), char => char.charCodeAt(0));
const gray = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAAAAABuG5crAAAAD0lEQVR4nGMQMhEy/f8fAAVbAoy6VK0cAAAAAElFTkSuQmCC"), char => char.charCodeAt(0));

it.each(["buffered", "retained", "streamed"].flatMap(mode =>
    ["txt:out.dat", "out.txt", "txt:-"].map(output => ({ mode, output }))
))("writes every TXT frame in order to $output mode=$mode", async ({ mode, output }) => {
    const files = new Map([["color.png", color], ["gray.png", gray]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const input = mode === "buffered" ? files : { filesystem, cwd: "/" };
    const first = await runConvertCli(["color.png", "txt:-"], input);
    const second = await runConvertCli(["gray.png", "txt:-"], input);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    let streamed = "";
    const result = await runConvertCli(["color.png", "gray.png", output], mode === "streamed" ? { filesystem, cwd: "/", stdout: { async write(bytes: Uint8Array) { streamed += new TextDecoder().decode(bytes); } } } : input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const path = output.startsWith("txt:") ? output.slice(4) : output;
    const text = path === "-" ? mode === "streamed" ? streamed : result.stdout : new TextDecoder().decode(mode === "buffered" ? files.get(path) : await filesystem.readFile(`/${path}`));
    expect(text.split("# ImageMagick pixel enumeration:")).toHaveLength(3);
    expect(text).toBe(first.stdout + second.stdout);
});
