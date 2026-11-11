import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Exact native ImageMagick Q16-HDRI raw output, without using our decoder as an oracle.
const fixtures = [
  { header: "P5\n1 1\n128\n", samples: [64], output: "404040404040" },
  { header: "P5\n1 1\n200\n", samples: [100], output: "646464646464" },
  { header: "P5\n1 1\n254\n", samples: [127], output: "7f7f7f7f7f7f" },
  { header: "P6\n1 1\n254\n", samples: [0, 127, 254], output: "00007f7ffefe" },
  { header: "P5\n1 1\n200\n", samples: [220], output: "dcdcdcdcdcdc" },
  { header: "P5\n1 1\n127\n", samples: [63], output: "7efd7efd7efd" },
  { header: "P2\n1 1\n200\n100\n", samples: [], output: "800080008000" },
  { header: "P3\n1 1\n254\n0 127 254\n", samples: [], output: "00008000ffff" },
  { header: "P5\n1 1\n255\n", samples: [127], output: "7f7f7f7f7f7f" },
  { header: "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 2\nMAXVAL 200\nTUPLTYPE GRAYSCALE_ALPHA\nENDHDR\n", samples: [100, 50], output: "6464646464643232", format: "rgba" },
  { header: "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 200\nTUPLTYPE RGB_ALPHA\nENDHDR\n", samples: [50, 100, 200, 100], output: "32326464c8c86464", format: "rgba" },
  { header: "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 5\nMAXVAL 200\nTUPLTYPE CMYK_ALPHA\nENDHDR\n", samples: [50, 100, 200, 100, 50], output: "32326464c8c864643232", format: "cmyka" }
];
for (const sync of [false, true]) for (const fixture of fixtures) {
  it(`converts ${JSON.stringify(fixture.header)} to native raw samples, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from(fixture.header), Buffer.from(fixture.samples)]);
    const args = ["in.pnm", "-depth", "16", "-endian", "MSB", `${fixture.format ?? "rgb"}:out.raw`];
    const files = new Map([["in.pnm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pnm", input);
    const result = sync ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = sync ? files.get("out.raw") : await filesystem.readFile("/out.raw");
    expect(Buffer.from(output!).toString("hex")).toBe(fixture.output);
  });
}
