import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentCommands, CommandRegistry, createAgentCommands, type PluginHost } from "../../../src/index.js";

const baseline60 = JSON.parse(readFileSync(new URL("./baseline60.json", import.meta.url), "utf8")) as string[];
const approved = ["seq", "nl", "rev", "unexpand", "split"];

function host(commands = new CommandRegistry()): PluginHost {
  return { commands, use() { throw new Error("Unexpected middleware"); }, registerFileSystem() { throw new Error("Unexpected filesystem"); } };
}

test("current registry is frozen60 plus fifty-two independently declared delivered commands", async () => {
  assert.equal(baseline60.length, 60);
  assert.equal(new Set(baseline60).size, 60);
  assert.deepEqual(baseline60.slice(-4), ["tac", "expand", "fold", "strings"]);
  const expected = ["gh", ...baseline60.filter(name => name !== "rg").flatMap(name => name === "[" ? ["[", "cmp", "fmt", "shuf", "numfmt"] : name === "sha256sum" ? ["sha512sum", "sha384sum", "sha256sum", "sha224sum"] : name === "zcat" ? ["zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "lzma", "unlzma", "lzcat", "zstd", "unzstd", "zstdcat", "dd"] : name === "mktemp" ? ["mktemp", "truncate", "install"] : name === "tar" ? ["tar", "zip", "unzip"] : [name]), ...approved, "date", "sleep", "printenv", "tree", "file", "rg", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit", "pr", "tsort", "factor", "getopt", "hexdump", "hd", "iconv", "dos2unix", "unix2dos", "mdq", "xan", "bc", "sponge", "openssl", "ssh", "ssh-keygen", "gpg", "fd", "less", "more", "id", "whoami", "uname", "hostname", "nproc", "yes", "envsubst", "cal", "ncal", "pathchk", "getconf", "locale", "df", "sqlite3", "yq", "htmlq", "diff3", "exiftool", "unrtf", "mmdc", "op", "ffmpeg", "ffprobe", "soffice", "libreoffice", "pandoc", "ssconvert", "pdfinfo", "pdfunite", "pdfseparate", "pdffonts", "pdfdetach", "pdftotext", "pdftohtml", "pdfimages", "pdftoppm", "pdftocairo", "pdftk", "qpdf", "sips", "magick", "convert", "mogrify", "composite", "montage", "identify", "compare", "wkhtmltopdf", "csvclean", "csvcut", "csvformat", "csvgrep", "csvjoin", "csvjson", "csvlook", "csvpy", "csvsort", "csvsql", "csvstack", "csvstat", "in2csv", "sql2csv"];
  assert.equal(expected.length, 189);
  assert.equal(new Set(expected).size, 189);
  assert.deepEqual(createAgentCommands().map(command => command.name), expected);
  const target = host();
  await agentCommands().setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name), expected);
  for (const name of ["curl", "safejs", "node", "npm", "npx"]) assert.equal(target.commands.has(name), false);
});

for (const name of approved) test(`${name} aggregate collision is atomic and replacement remains explicit`, async () => {
  const original = { name, execute: () => ({ exitCode: 23 }) };
  const custom = { name: "custom", execute: () => ({ exitCode: 24 }) };
  const target = host(new CommandRegistry([original, custom]));
  const before = target.commands.list();
  assert.throws(() => agentCommands().setup(target), new RegExp(`already registered: ${name}`, "u"));
  assert.deepEqual(target.commands.list(), [original, custom]);
  await agentCommands({ replace: true }).setup(target);
  assert.equal(target.commands.list().length, 190);
  assert.equal(target.commands.get("custom"), before[1]);
  assert.notEqual(target.commands.get(name), before[0]);
});
