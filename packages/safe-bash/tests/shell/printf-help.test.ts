import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem, Shell, standardCommands } from "../../src/index.js";

// GNU Bash 5.3, LC_ALL=C; the host Bash may provide older help text.
const help = [
  "printf: printf [-v var] format [arguments]",
  "    Formats and prints ARGUMENTS under control of the FORMAT.",
  "    ",
  "    Options:",
  "      -v var\tassign the output to shell variable VAR rather than",
  "    \t\tdisplay it on the standard output",
  "    ",
  "    FORMAT is a character string which contains three types of objects: plain",
  "    characters, which are simply copied to standard output; character escape",
  "    sequences, which are converted and copied to the standard output; and",
  "    format specifications, each of which causes printing of the next successive",
  "    argument.",
  "    ",
  "    In addition to the standard format characters csndiouxXeEfFgGaA described",
  "    in printf(3), printf interprets:",
  "    ",
  "      %b\texpand backslash escape sequences in the corresponding argument",
  "      %q\tquote the argument in a way that can be reused as shell input",
  "      %Q\tlike %q, but apply any precision to the unquoted argument before",
  "    \t\tquoting",
  "      %(fmt)T\toutput the date-time string resulting from using FMT as a format",
  "    \t        string for strftime(3)",
  "    ",
  "    The format is re-used as necessary to consume all of the arguments.  If",
  "    there are fewer arguments than the format requires,  extra format",
  "    specifications behave as if a zero value or null string, as appropriate,",
  "    had been supplied.",
  "    ",
  "    Exit Status:",
  "    Returns success unless an invalid option is given or a write or assignment",
  "    error occurs.",
  "",
].join("\n");

for (const [script, exitCode, stdout] of [
  ["printf --help", 2, help],
  ["builtin printf --help", 2, help],
  ["command printf --help", 2, help],
  ["printf --help ignored", 2, help],
  ["printf -v value --help", 2, help],
  ["value=original; printf -v value --help; status=$?; printf '%s:%s' \"$value\" \"$status\"", 0, help + "original:2"],
  ["for ((i=0; i<2; i++)); do printf --help; done", 2, help.repeat(2)],
  ["printf -- --help", 0, "--help"],
  ["printf -- '--help:%s' literal", 0, "--help:literal"],
  ["printf %s --help", 0, "--help"],
  ["printf -v value -- --help; printf %s \"$value\"", 0, "--help"],
] as const) {
  test(`printf builtin help: ${script}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(standardCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(stdout));
    } finally { await shell.dispose(); }
  });
}
