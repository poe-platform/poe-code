import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { adapterStatements } from "../../scripts/fixtures/command-adapter-statements.js";

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

const extractedAdapters = [
  "xan", "html-to-markdown", "column", "du", "file", "tree", "split", "csplit",
  "pr", "tsort", "factor", "getopt", "hexdump", "iconv", "line-endings", "which",
  "timeout", "apply-patch", "op",
];

describe("extracted command ownership", () => {
  it.each(extractedAdapters)("keeps %s implementation in its command workspace", adapter => {
    const workspace = `safe-bash-command-${adapter === "line-endings" ? "dos2unix" : adapter}`;
    const file = path.join(root, "packages/safe-bash/src/commands", adapter, "index.ts");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let forwardsWorkspace = false;
    const evaluator = "evalSync" + adapter.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
    for (const statement of adapterStatements(source, workspace, evaluator)) {
      if (ts.isImportDeclaration(statement)) {
        // Some portable adapters initialize the shared Buffer compatibility layer.
        expect(statement.importClause).toBeUndefined();
        expect((statement.moduleSpecifier as ts.StringLiteral).text).toBe("../../portable-buffer.js");
      } else {
        expect(ts.isExportDeclaration(statement), `${adapter}: implementation must live in ${workspace}`).toBe(true);
        if (!ts.isExportDeclaration(statement)) continue;
        expect(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)).toBe(true);
        expect(adapter === "line-endings" ? [workspace, "safe-bash-command-unix2dos"] : [workspace]).toContain((statement.moduleSpecifier as ts.StringLiteral).text);
        if (!statement.exportClause) forwardsWorkspace = true;
      }
    }
    expect(forwardsWorkspace, `${adapter}: missing workspace facade`).toBe(true);
  });
});
