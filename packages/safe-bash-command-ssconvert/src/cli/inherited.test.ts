import { describe, expect, it } from "vitest";
import { parseCommand } from "./parser.js";

describe("captured inherited help and options", () => {
  it("provides the released three-line version without a host profile", () => {
    expect(parseCommand(["--version"])).toMatchObject({ exitCode: 0,
      stdout: "ssconvert version '1.12.61'\ndatadir := '/opt/ssconvert-reference/share/gnumeric/1.12.61'\nlibdir := '/opt/ssconvert-reference/lib/gnumeric/1.12.61'\n" });
  });
  it("distinguishes group help and keeps hidden entries hidden", () => {
    const main = parseCommand(["-h"]), all = parseCommand(["--help-all"]);
    expect(main).toMatchObject({ exitCode: 0 });
    expect(all).toMatchObject({ exitCode: 0 });
    if (main.kind !== "terminal" || all.kind !== "terminal") throw Error("terminal expected");
    expect(main.stdout).not.toContain("--lib-dir");
    expect(all.stdout).toContain("--lib-dir=DIR");
    expect(all.stdout).not.toContain("--solve");
    expect(parseCommand(["--help-libspreadsheet"])).toMatchObject({ exitCode: 0 });
    expect(parseCommand(["--help-gtk"])).toMatchObject({ exitCode: 0 });
  });
  it("parses roots and aliases without changing initialized version roots", () => {
    expect(parseCommand(["-L", "/elsewhere", "--libspreadsheet-data-dir=/data", "--version"]))
      .toEqual(parseCommand(["--version"]));
    expect(parseCommand(["--libspreadsheet-version", "--version"])).toMatchObject({
      exitCode: 0, stdout: expect.stringMatching(/^gnumeric version/) });
    expect(parseCommand(["-v", "in", "out"])).toMatchObject({ flags: ["verbose"] });
  });
  it("uses explicitly bound virtual roots without consulting the filesystem", () => {
    const profile = { configurationRoots: { dataDir: "/virtual/data", libDir: "/virtual/lib" } };
    expect(parseCommand(["-D", "/ignored", "--version"], profile)).toMatchObject({
      exitCode: 0, stdout: "ssconvert version '1.12.61'\ndatadir := '/virtual/data'\nlibdir := '/virtual/lib'\n" });
  });
  it.each(["screen", "sync", "gtk-debug", "gtk-no-debug", "help-gdk", "usage", "gdk-display"])
  ("rejects absent reference option %s", (name) => {
    expect(parseCommand([`--${name}`, "--version"])).toMatchObject({ exitCode: 1,
      stderr: `Unknown option --${name}\nRun 'ssconvert --help' to see a full list of available command line options.\n` });
  });
  it("does not hide observable GTK module loading behind version", () => {
    expect(parseCommand(["--gtk-module=missing", "--version"])).toMatchObject({ exitCode: 1,
      stderr: "Unsupported ssconvert feature: --gtk-module (virtual runtime parity blocker)\n" });
  });
});
