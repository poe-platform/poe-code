import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const commands = [
  "apply-patch", "cmp", "column", "csplit", "docx", "du", "expr", "factor", "file",
  "getopt", "hexdump", "html-to-markdown", "iconv", "install", "dos2unix", "pptx",
  "pr", "split", "timeout", "tree", "truncate", "tsort", "which", "xan", "tar", "zip",
  "unzip", "gzip", "diff", "patch", "jq", "rg", "find", "sed", "awk", "curl", "wget",
  "csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "fmt", "fold", "htmlq",
  "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm",
  "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz",
];
const manifest = JSON.parse(readFileSync(path.join(root, "packages/safe-bash/package.json"), "utf8"));

describe("standalone Safe Bash command packaging", () => {
  it.each(commands)("keeps %s private, portable and available to public consumers", command => {
    const name = `safe-bash-command-${command}`;
    const directory = path.join(root, "packages", name);
    const pkg = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    expect(pkg.name).toBe(name);
    expect(pkg.private).toBe(true);
    expect(manifest.devDependencies[name]).toBe("*");
    expect(manifest.poeCode.integration.privateWorkspaces[name].portable).toBe(true);
    expect(pkg.devDependencies["safe-bash-contracts"]).toBe("*");
    expect(existsSync(path.join(directory, "README.md"))).toBe(true);
    expect(manifest.exports[`./commands/${command}`]).toBeDefined();
  });
});
