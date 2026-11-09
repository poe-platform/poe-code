import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("./fixtures/emboss-channels.png", import.meta.url)));
// ImageMagick 7.1.2-35 Q16-HDRI: input.png -background '#193b7580'
// -virtual-pixel <method> -emboss 2x1 PNG32:out.png, decoded with -depth 8 rgba:-.
const native = {
  "edge": "AABl/2V3SwAAQWztAP//AJe+7f8AACjGACjGACiMsP//AACId0FlADJlgf/t/wB3iN///wAAAFpBbOYAZbff/wAAAEQrT3MAAJ7G/wD//wAoS3MAKFqp/wD//wDJ7f//By+l/wD//wDG5v//AFZ3/wv//wCI4v//AF1+/wAA/wDf////AAAAzQAA/wBzze3/AAs5mv8AAFN31+3/AAAAGf8AAGyIrJcAAAAAKAD//wBBZd8AZYil2////wDtAAAAiKzb/yhad6UAAP8Aeprf/12FntcABzJ+SAAAAC9lerQoU3fC/wAAc6WIqQAyZYH/AAAyogAr/wBl1+3/HU9z/wAAAJcAAP8Ad5e+/wAvZf//AACFAChPAJe+3/8AAHP/AP//AAAZRACTu9//AABz//8AAA4AKE8AMsLf/wAoWv8AAACsAAvGAEHG5v8LMmX/AABBxgAA/wBPze3/AG+M3wAHMn4A//8AZQcvAEtzpf9liKzi////AAAAwgBvjOb/otft/wAAAFoA//8A",
  "tile": "AAAAYcnpAAAAAABhAO3/AIi+7f8AACCwJFrbABk9Zf8A//8A5gQoAChhc/8AIP8Aft///wAAAFo9ZeYAYbTb/wAAAD0kVm8AAJrJ/wD//wAgS2gAPWW0/yD//wDJ6f//BCie/wD//wDJ4v//AFZs/w7//wB+4v//AF1z/wAA/wCIwv//AAAA4gAA/wBoyen/AA4yjP8AAFZv1O3/AAAAHf8AAGV+qYgAAAAAKP8AAD3//wAOXX6p3////wDpAAAAfqnX/yRWb54AAP8Ac4zf/1p6k9QAJFZ+AA45AACMxv8kVm+w/wAAaJ5+pQArYXf/AAArlwAo/wBh1O3/HU9o/wAAAIUAAIgAl8nm/wAoYf//AAB6ACBPAIi73/8AAGj/AP//AAAdSACItN//AABs/wD//wBhAAAAK8Lf/wAkWv8AAACpAA7GAD3J4v8EK2H/AAA9yQAA/wBT1O3/AAAATwAgS4UA//8AACRTAFZsu/8ok8n/////AAAAwgBoheL/u9///wCItP//ACD/",
  "black": "AAAAABkZAAAAAAAAAD4pALX///9nIQAAAAAtAIDW//8AVjUAPgAEAGvB//8AAAAAc87//wAAAFY+Y8EAX6DB/wAAAD4lSmcAAISt/wD//wAlSmcAZ7n/1gBvcwCt1v//CCmE/wD//wCpzv//AFJn/xD//wBzxf//AFpr/wAA/wD/////d0YAAAAA/wBnqdL/ABA6e/8AAE5ntdb/AAAAIf8AAGdvjHcAAAAAJQAVAAAAABAAY3eYtf///wDWAAAAb5C5/ylWZ4AAAP8Aa3vB/1pre7UAKV9rAAAAAP///2MpX2uM/wAAZ4BvhAAtX2v/AAAtgAAp/wBftdb/IUpn/wAAAG8AACkA////rQAtX///AABrACVKAHecwf8AAGf/AP//AAAhRgB3mMH/AABn/wB3cwAAAAAALanO/wApX/8AAAB7AAycAEKp0v8VPmf/AABKoAAA/wBawf//AAAAAAAAAAAAHQAAAAAIAHfS//////9nAAAAAAAAPgCp/////////////0IAAAAA",
  "mirror": "AABf/2aASQAASXXwAP//AJnB9P8AACjIACjIACiOs///AACKeEJqADNmgP/i/wB4iuL//wAAAF9CauYAZrri/wAAAEUsUHUAAKDI/wD//wAoTXUALF+o/wD//wDM7f//By+o/wD//wDI5v//AFR1/w///wCO5v//AGKA/wAA/wDe////AAAH0AAA/wB10O3/AA86nf8AAFR42/D/AAAAHf8AAGqKr5kAAAAAKAD//wA6ZuIAZoeo3v///wDwAAAAiq/e/yhfeKgAAP8AfJ3i/1+HoNsABzOARQAAACxfeKgoVHXF/wAAdaiKqwAzZoP/AAAzpAAs/wBm2/T/HVB1/wAAAJkAAP8AdZnB/wAvZv//AACHACRQAJnB4v8AAHX/AP//AAAdRQCZveL/AAB1//8AAAcAIUkAM8Xi/wAoX/8AAACvAA/IAD7I5v8LM2b/AABCyAAA/wBQ0PD/AHWV3gAALHwA//8AagAvAFB1qP9mjq/iAAAAAAAAwQBtjub/qN7//wAAAGYA//8A",
  "transparent": "CzZo////AAAANmj//wAAd4ii3/8AAB3/AAD/AGGBov//AACl7QAWADlskP/b8QD/kOL//wAAAG9Bb+0AaMLi/wAAAF0dU3oAAKXU/wD//wAdT3cAL2Wa/wD//wDU8f//By+w/wD//wDU6f//AFZ6/wv//wCQ6f//AGGI/wAA/wCl1O3/AAAO/wAA/wB31PH/AAs9ov8AAFaB2/H/AAAAGf8AAG+QtJ4AAAAANv8AHdTC4gBsaJCw6f///wDxAAAAkLff/yBdgawAAP8AiKLi/12QpdsAHVaXAAAAAF2Bnv8dXXrU/wAAd6yQsAA2aIj/AAAyqQAo/wBl2/H/GU96/wAAAJ4AAP8AgZrJ/wAvaP//AACQAB1PAJrG5v8AAHf/AP//AAAZSACXwuL/AAB6//8AAGUAAAAAMsbi/wAkXf8AAAC+AAvUAEHU6f8OPWz/AABB2wAA/wBW1PH/JF2B/x1Wev//AB3XAAAdAFZ6sP9ljKX/CzZo/wAA/wB6l9v/kL7f/096l//tHUj/",
  "background": "AAAAaztZHgAAJSmqAP//AIm86f8AAABGAACuAGeFo/8A//8AayVZADtrfv///wAlgd7//wAAAFk7ZOEAWbza/wAAAEYlSmsAAJvI/wD//wAlRmsAN2Cm/wD//wDI7f//BCWf/wD//wDI4f//AFFr/wv//wCF4f//AFVv/wAA/wDT7f//AAAAWQAA/wBryOn/AAs0lP8AAFFrz+3/AAAAHv8AAGeFqowAAAAAJQD//wAAANYAWYGm2v///wDtAAAAgarW/yVRa5sAAP8Ab5Ta/1VzmNMAJUaBAAAlAGuQrv8lUWu5/wAAa5uBpgAsWXP/AAApmwAl/wBZ0+3/HkZr/wAAAIkAAKMAlMje/wAlWf//AABzACVGAIm83v8AAGv/AP//AAAeQwCJudr/AABr/wD//wAAACUALMDe/wAlVf8AAACjAAvIADvI4f8LN2D/AAA7yAAA/wBRz+3/N2dryB5VZ8gA//8AACVZAFlzwP9rm8D/ACUlfgAA0wCBqun/wOH//2uFm///AAAE"
};

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([...Object.keys(native), "reset"])(`matches the full native emboss raster with %s virtual pixels (${mode})`, async method => {
        const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = ["input.png", "-background", "#193b7580", "-virtual-pixel", method === "reset" ? "tile" : method,
            ...(method === "reset" ? ["+virtual-pixel"] : []), "-emboss", "2x1", "-virtual-pixel", "white", "PNG32:out.png"];
        let stderr = "";
        const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([11, 9]);
        expect(Buffer.from(output.data).toString("base64")).toBe(native[method === "reset" ? "edge" : method as keyof typeof native]);
    });
}
