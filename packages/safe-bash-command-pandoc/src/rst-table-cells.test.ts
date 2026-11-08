import { expect, it } from "vitest";
import { createStandalonePandocCommand } from "./safe-bash.js";

it.each([
  "===== =====\nA     B\n===== =====\n1     2\n===== =====\n",
  "+---+---+\n| A | B |\n+===+===+\n| 1 | 2 |\n+---+---+\n"
])("compacts single-paragraph RST table cells: %j", async source => {
  for (const format of ["json", "html"]) {
    const stdout: Uint8Array[] = [];
    expect(await createStandalonePandocCommand().execute({
      args: ["-f", "rst", "-t", format], stdin: [new TextEncoder().encode(source)],
      stdout: {write: async chunk => {stdout.push(chunk);}}, stderr: {write: async () => {}},
      signal: new AbortController().signal
    })).toEqual({exitCode: 0});
    const output = new TextDecoder().decode(Buffer.concat(stdout));
    if (format === "json") {
      const table = JSON.parse(output).blocks[0].c;
      expect(table[3][1][0][1].map((cell: unknown[]) => cell[4])).toEqual([
        [{t: "Plain", c: [{t: "Str", c: "A"}]}],
        [{t: "Plain", c: [{t: "Str", c: "B"}]}]
      ]);
      expect(table[4][0][3][0][1].map((cell: unknown[]) => cell[4])).toEqual([
        [{t: "Plain", c: [{t: "Str", c: "1"}]}],
        [{t: "Plain", c: [{t: "Str", c: "2"}]}]
      ]);
    } else {
      expect(output).toContain('<th scope="col">A</th>');
      expect(output).toContain("<td>1</td>");
      expect(output).not.toContain("<p>");
    }
  }
});
