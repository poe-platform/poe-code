import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

const properties = ["area", "angle", "width", "height", "unrotate", "perimeter"];
const fixture = (square: boolean) => Buffer.concat([
  Buffer.from("P6\n7 5\n255\n"),
  Buffer.from(Array.from({ length: 35 }, (_, i) => {
    const x = i % 7, y = Math.floor(i / 7);
    return (x === 3 || x === 4) && (y === 2 || y === 3) ? [160, 30, 90]
      : !square && x === 1 && y === 1 ? [249, 249, 249] : [255, 255, 255];
  }).flat())
]);

// Native ImageMagick 7.1.2-35 Q16-HDRI: perimeter is coordinate text, not a length.
for (const route of ["sync", "buffered", "retained", "identify", "magick-identify", "magick"]) {
  for (const square of [false, true]) {
    it.each(properties)(`expands minimum-bounding-box:%s without the parent (${route}, square=${square})`, async property => {
      const bytes = fixture(square && route !== "magick"), files = new Map([["/in.ppm", bytes]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.ppm", bytes);
      const format = `%[minimum-bounding-box:${property}]`;
      const args = ["-format", format, "/in.ppm"];
      let result;
      if (route === "sync") result = runIdentifyCliSync(args, files);
      else if (route === "buffered" || route === "retained") result = await runIdentifyCli(args, route === "buffered" ? files : { filesystem: fs, cwd: "/" });
      else {
        const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
        const argumentValues = createCommandArguments(route === "magick" ? ["/in.ppm", ...(square ? ["-fill", "white", "-opaque", "#f9f9f9"] : []), "-format", format, "info:"] : [...(route === "magick-identify" ? ["identify"] : []), ...args]);
        let stdout = "", stderr = "";
        const status = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
      }
      const expected = square ? ["1", "0", "1", "1", "-0", "3,2 "] : ["4.4", "18.4349", "1.26491", "3.47851", "-18.4349", "1,1 "];
      expect(result).toEqual({ exitCode: 0, stdout: expected[properties.indexOf(property)], stderr: "" });
    });
  }
}

it("honors metric precision, case-insensitive names and repeated lookups with ping", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", fixture(false));
  expect(await runIdentifyCli(["-ping", "-precision", "12", "-format", "%[MINIMUM-BOUNDING-BOX:WIDTH]|%[minimum-bounding-box:angle]|%[minimum-bounding-box:width]", "/in.ppm"], { filesystem: fs, cwd: "/" })).toEqual({
    exitCode: 0, stdout: "1.26491106407|18.4349488229|1.26491106407", stderr: ""
  });
});

it.each([
  { name: "rectangle", points: [[1, 2], [4, 2], [4, 3], [1, 3]], expected: "3|0|1|3|-0|1,2 " },
  { name: "diamond", points: [[2, 0], [4, 2], [2, 4], [0, 2]], expected: "8|-45|2.82843|2.82843|45|2,0 " },
  { name: "horizontal line", points: [[2, 2], [3, 2], [4, 2]], expected: "0|0|0|2|-0|2,2 " },
  { name: "vertical line", points: [[2, 1], [2, 2], [2, 3]], expected: "0|0|0|2|-0|2,1 " },
  { name: "single point", points: [[2, 2]], expected: "|||||" },
  { name: "solid image", points: [], expected: "|||||" }
])("matches native combined metrics for $name", async ({ points, expected }) => {
  const bytes = Buffer.concat([
    Buffer.from("P6\n7 5\n255\n"),
    Buffer.from(Array.from({ length: 35 }, (_, i) => points.some(([x, y]) => x === i % 7 && y === Math.floor(i / 7)) ? [0, 0, 0] : [255, 255, 255]).flat())
  ]);
  const args = ["-format", properties.map(property => `%[minimum-bounding-box:${property}]`).join("|"), "/in.ppm"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", bytes);
  const result = { exitCode: 0, stdout: expected, stderr: points.length < 2 ? properties.map(property => `identify: unknown image property '%[minimum-bounding-box:${property}]'\n`).join("") : "" };
  expect(runIdentifyCliSync(args, new Map([["/in.ppm", bytes]]))).toEqual(result);
  expect(await runIdentifyCli(args, { filesystem: fs, cwd: "/" })).toEqual(result);
});
