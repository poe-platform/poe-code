import { expect, it } from "vitest";
import { parseCommand } from "./parser.js";

it("matches captured abbreviated GOption group version and warning aliases", () => {
  for (const prefix of ["l", "li", "lib", "libs", "libspreadsheet"])
    expect(parseCommand([`--${prefix}-version`])).toEqual(parseCommand(["--libspreadsheet-version"]));
  for (const prefix of ["g", "gt", "gtk"])
    expect(parseCommand([`--${prefix}-g-fatal-warnings`, "--version"]))
      .toEqual(parseCommand(["--version"]));
});

it("uses inherited entry names in missing-argument errors", () => {
  for (const option of ["--l-lib-dir", "--libspreadsheet-lib-dir"])
    expect(parseCommand([option])).toMatchObject({ exitCode: 1,
      stderr: "Missing argument for --lib-dir\nRun 'ssconvert --help' to see a full list of available command line options.\n" });
});

it("does not abbreviate help groups or option names or extend group names", () => {
  for (const option of ["--help-l", "--l-vers", "--libspreadsheetx-version", "--gt-displa=x", "---version"])
    expect(parseCommand([option])).toMatchObject({ exitCode: 1,
      stderr: `Unknown option ${option}\nRun 'ssconvert --help' to see a full list of available command line options.\n` });
});
