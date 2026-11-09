import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDA6MDk6MTQrMDA6MDB7CxdkAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAwOjA5OjE0KzAwOjAwClav2AAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMDowOToxNCswMDowMF1DjgcAAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg==", "base64");
// ImageMagick 7.1.2-31 Q16-HDRI: in.png [-intensity method] <operation> 5x10% PNG32:out.png
// Both stretch operations produce these same depth-8 RGBA samples.
const cases = [
    {
        "method": "",
        "rgba": "AHH/AJj/AIv/H7P/RtoAOf8AYfUAiP8Ar/8PowA2yv9d8QBR/wB4/wuf/wDG/ya6AE3hAHT/AGj/AI//Irb/Ft0APdEAZPgAi/8Af/8Spv85zf8t9QBU6AB7/wCj/wKW/ym9/1HlAET/AGv/AJP/ALr/Ga0AQdQAaPwAW/8Agv8Wqv8J0QAxxABY7AB//wBy/waa/y3B/yDoAEjcAG//AJb/AIr/HbH/RNgAOP8AX/MAhv8Arf8NoQA0yP9b7wBP/wB2/wmd/wDE/yS4AEvfAHL/AGb/AI3/ILT/FNwAO88AYvYAiv8Aff8QpP84zP8r8wBS5gB6/wCh/wCU/yi8/w=="
    },
    {
        "method": "Brightness",
        "rgba": "AABgAACuAAD7AADjAAsAAFkAAEAAAI4AANwAAAAAAP8AOQAAhwAAbgAAvAAA/wAAAAAZAABnAAC1AACcAADqABIAAAAAAEcAAJUAAOMAAMoAAP8AQAAAJwAAdQAAwwAA/wAA+AAgAABuAABVAACjAADxAAAAAAAAAE4AAJwAAIMAANEAAAAAAAAALgAAfAAAygAAsQAA/wAnAAAOAABcAACqAAD4AADfAAcAAFUAADwAAIoAANgAAAAAAP8ANQAAgwAAagAAuAAA/wAAAAAVAABjAACxAACYAADmAA4AAAAAAEMAAJEAAN8AAMYAAP8APAAAIwAAcQAAvwAA/wAA9A=="
    },
    {
        "method": "Average",
        "rgba": "AGL/ALD/AJf/AOX/Df8AAP8AQv8AkP8A3v8AxQAA//87/wAi/wBw/wC+/wD//wDzABv/AGn/AFD/AJ7/AOz/AP8AAP8ASf8Al/8Afv8AzP8A//8A/wAp/wB3/wDF/wCs/wD6/yL/AAn/AFf/AKX/APP/ANoAAv8AUP8AN/8Ahf8A0/8A/wAA/wAw/wB+/wBm/wCz/wD//wD/ABH/AF7/AKz/AJT/AOH/Cf8AAP8AP/8AjP8A2v8AwgAA//83/wAf/wBt/wC7/wD//wDwABj/AGb/AE3/AJv/AOn/AP8AAP8ARv8AlP8Ae/8Ayf8A//8A/wAm/wB0/wDC/wCp/wD3/w=="
    },
    {
        "method": "Rec709Luma",
        "rgba": "AHH/AJj/AIv/H7P/RtoAOf8AYfUAiP8Ar/8PowA2yv9d8QBR/wB4/wuf/wDG/ya6AE3hAHT/AGj/AI//Irb/Ft0APdEAZPgAi/8Af/8Spv85zf8t9QBU6AB7/wCj/wKW/ym9/1HlAET/AGv/AJP/ALr/Ga0AQdQAaPwAW/8Agv8Wqv8J0QAxxABY7AB//wBy/waa/y3B/yDoAEjcAG//AJb/AIr/HbH/RNgAOP8AX/MAhv8Arf8NoQA0yP9b7wBP/wB2/wmd/wDE/yS4AEvfAHL/AGb/AI3/ILT/FNwAO88AYvYAiv8Aff8QpP84zP8r8wBS5gB6/wCh/wCU/yi8/w=="
    }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-contrast-stretch", "-linear-stretch"]) {
        it.each(cases)(`${mode}: ${operation} uses $method intensity for its histogram`, async ({ method, rgba }) => {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const files = new Map<string, Uint8Array>([["in.png", input]]);
            const argv = ["in.png", ...(method ? ["-intensity", method] : []), operation, "5x10%", "PNG32:out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(decodeImage(output).data).toEqual(new Uint8Array(Buffer.from(rgba, "base64")));
        });
    }
}
