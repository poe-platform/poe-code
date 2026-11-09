import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// 10x8 RGB grid and the five-point fit from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAICAIAAABPmPnhAAAANUlEQVR4nGPk1fGOxQ0Y1597i086sKAfn/RnIUN80lO3XMYnbR5Wik/65g9xfNLVs3bikQYAyL1ayQ0vjokAAAAASUVORK5CYII=", "base64");
const expected = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAICAMAAAD3JJ6EAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAADnUExURVd2lUdmhWOCgbTTJFJxSF18m7nYXGqJXpSz0rw1VJm412yLqiJBYFx7mqHAOWOCTnmYhpq5UnKRr7RIZ1hsi3OSsZ693C1Ma1V0e5OyRmKBU4alhZi3Q5V2ldwfPrU8W159nIinxkhnhkxrdJSzQ09uWJKxl36dXrGEo7RxkMsrSoBmhX2cu1RzkkNie6vKKjZVX6bFYWB/nmt4l6WDosRGZZZMa32bupOyUH+eS4uqTGB/g4KEo8FefaZBYIeBoGSDoitKaarJ6LjXUKfGZ6LBRXeWWGGAn7xnhpRCYZe21Rs6WbLR8CHHJzQAAAAHdElNRQfqCwcJGQl8AbHfAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjI1OjA5KzAwOjAwnVlCpwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOToyNTowOSswMDowMOwE+hsAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDk6MjU6MDkrMDA6MDC7EdvEAAAAYElEQVQI12NgYGRiZmFlY+fgZODi5uHl4xcQFBJmEBEVE5eQlJKWkWWQk1dQVFJWUVVTZ9DQ1NLW0dXTNzBkMDI2MTUz12W0YGCwtLK2sbWzd3B0YnB2cXVz9/D08vYBAFnUC521oTt2AAAAAElFTkSuQmCC", "base64"));
const corners = ["0,0 0,0", "9,0 9,0", "0,7 0,7", "9,7 9,7"];

for (const mode of ["public", "sync"] as const) {
    it.each([
        ["four-point identity", "-distort", corners, decodeImage(input)],
        ["five-point fit", "-distort", [...corners, "4,4 7,4"], expected],
        ["reordered five-point fit", "-distort", ["4,4 7,4", ...corners], expected],
        ["ten-point fit", "-distort", [...corners, "4,4 7,4", ...corners, "4,4 7,4"], expected],
        ["six-point fit", "-distort", ["0,0 0,0 9,0 9,0 0,7 0,7 9,7 9,7 4,4 7,4 2,2 1,3"], decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAICAMAAAD3JJ6EAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAADqUExURT1ce2WEnajHPI2sJi5NbHqZuM7tOFl4aJCvzuAgP3GQryNCYVZ1dImoYIuqKVBvfp69dIemVHqZtsdAX3KRsHWUs1BvjkRjbZCvYX6dNFd2faXEbX+eVJV6mZ1LaomEo1p5mDhXdoGgYYKhNE1sfKHAdn2cadNJaKhNbJJhgHybumiHpjpZeG+OcqC/Gj1cdrjXU36dvKNvjsBUc6c9XHx8m3+evStKaYyrSlRzklZ1Y2+Od26Doqh4l8c+XX5RcI2fvld2lT9efb3c+8blN6fGVJa1P2GAb3OSsdBEY25XdqC/3jVUc8Df/iGCXo0AAAAHdElNRQfqCwkFOgK8v5FhAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA5VDA1OjU4OjAyKzAwOjAw+aPHPgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOVQwNTo1ODowMiswMDowMIj+f4IAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDlUMDU6NTg6MDIrMDA6MDDf615dAAAAYElEQVQI12NgYGRiZmFlY+fgZODi5uHl4xcQFBJmEBEVE5eQlJKWkWWQk+dSUFRSVlFVY1DX0NTS1tHV0zdgMDQyNjE1M1ewsGSwsraxtbN3cHRyZnBxdXP38PTy9vEFAFvgC+YkC5x3AAAAAElFTkSuQmCC", "base64"))],
        ["expanded five-point fit", "+distort", ["0,0 0,0 9,0 9,0 0,7 0,7 9,7 9,7 4,4 7,4"], decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAMAAABhq6zVAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAF3UExURQ0sS0RjgoKhfsXkCEhnTWGAn7vaWm2MXI6tzM8qSVJxkD9efX2chsLhDk1sS19+nbrZW2uKXZGwz8UvTmeGpVd2lUdmhWOCgbTTJFJxSF18m7nYXGqJXpSz0rw1VJKx0Jm412yLqiJBYFx7mqHAOWOCTnmYhpq5UnKRr7RIZ1ltjF1piFhsi3OSsZ693C1Ma1V0e5OyRmKBU4alhZi3Q5V2lc9Tct0fPtwfPrU8W159nIinxkhnhkxrdJSzQ09uWJKxl36dXktqibR/nrGEo7RxkMsrSoBmhX2cu1RzkkNie6vKKjZVX6bFYcLhQmaFpGB/nmt4l6WDosRGZZZMa32bupOyUDJRcG6NVX+eS4uqTGB/g4KEo8FefaZBYIeBoGSDoitKaarJ6MDf/sXkObjXUKfGZ6LBRXeWWLxnhpRCYZe21Rs6WbLR8Huaub/eQ4GgSLpripVBYJi31h8+XbnY97nYTYmoQ1l4l7dvjpZBYJq52CNCYSmnSisAAAAHdElNRQfqCwkFOgK8v5FhAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA5VDA1OjU4OjAyKzAwOjAw+aPHPgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOVQwNTo1ODowMiswMDowMIj+f4IAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDlUMDU6NTg6MDIrMDA6MDDf615dAAAAEGNhTnYAAAAMAAAADP/////////+HNldoAAAAKBJREFUCNdjYGBgZGJmYWVj5+DkYmBg4Obh5eMXEBQS5mIQERUTl5CUkpaRleNikFdQVFJWUVVT19DUYtDW0dXTNzA0MjYxNWMwt7C0sraxtbN3cHRicHZxdXP38PTy9vH1Y/APCAwKDgn1FAsTDWeIiIyKjomNi09ITEpmSElNS89gzczKzslNZsjLy8svkCosKi4pBXPKyisqq6prkpMBEvYioMvtamkAAAAASUVORK5CYII=", "base64"))]
    ] as const)(`matches native Perspective pixels for %s (${mode})`, async (_, operator, points, reference) => {
        const keep = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        await fs.writeFile("/out.png", keep);
        const files = new Map([["/input.png", input], ["/out.png", keep]]);
        const args = ["/input.png", "-filter", "point", operator, "Perspective", points.join(" "), "/out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            signal: new AbortController().signal, fs,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([reference.width, reference.height]);
        expect(output.data).toEqual(reference.data);
    });
}
