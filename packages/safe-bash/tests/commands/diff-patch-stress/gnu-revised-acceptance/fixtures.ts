import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export interface Fixture {
  readonly id: string;
  readonly family: "syntax-cohort" | "quoted-selection" | "selected-output";
  readonly files: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, string>>;
  readonly input: string;
  readonly args: readonly string[];
  readonly policy: "conflict" | "syntax" | "selected-path" | "apply";
}

export const replacement = (name: string, before = "old", after = "new") =>
  `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;

export const malformed: Readonly<Record<string, string>> = {
  "missing-old-body": "@@ -1,2 +1 @@\n-old\n+new\n",
  "missing-new-body": "@@ -1 +1,2 @@\n-old\n+new\n",
  "extra-old-body": "@@ -1 +1 @@\n-old\n-extra\n+new\n",
  "extra-new-body": "@@ -1 +1 @@\n-old\n+new\n+extra\n",
  "zero-count-noop": "@@ -0,0 +0,0 @@\n",
  "zero-start-nonempty": "@@ -0 +1 @@\n-old\n+new\n",
  "negative-count": "@@ -1,-1 +1 @@\n-old\n+new\n",
  "noninteger-count": "@@ -1,1.5 +1 @@\n-old\n+new\n",
  "orphan-newline-marker": "\\ No newline at end of file\n@@ -1 +1 @@\n-old\n+new\n",
  "duplicate-newline-marker": "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n\\ No newline at end of file\n",
  "empty-incomplete-line": "@@ -1 +1 @@\n-old\n+\n\\ No newline at end of file\n",
  "content-after-incomplete-old": "@@ -1,2 +1 @@\n-old\n\\ No newline at end of file\n-tail\n+new\n",
  "content-after-incomplete-new": "@@ -1 +1,2 @@\n-old\n+new\n\\ No newline at end of file\n+tail\n",
  "backward-second-hunk": "@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n",
  "missing-physical-newline": "@@ -1 +1 @@\n-old\n+new",
  "header-only": "",
  "context-only-hunk": "@@ -1 +1 @@\n old\n",
};

const original = readFileSync(new URL("../fuzz/edits.test.ts", import.meta.url), "utf8");
const originalEntries = [...original.slice(original.indexOf("const malformed:"), original.indexOf("for (const [name, broken]"))
  .matchAll(/^ {2}("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$/gmu)]
  .map(match => [JSON.parse(match[1]!), JSON.parse(match[2]!)]);
assert.equal(originalEntries.length, 17, "The entire original malformed cohort must remain present");
assert.deepEqual(Object.fromEntries(originalEntries), malformed, "Do not revise any original input byte");

const syntaxFiles = { first: "keep\n", target: "old\nmiddle\ntail\n" };
const first = replacement("first", "keep", "changed");
const syntaxFixtures: Fixture[] = Object.entries(malformed).map(([name, body]) => ({
  id: `original-syntax/${name}`, family: "syntax-cohort", files: syntaxFiles, links: {},
  input: `${first}--- target\n+++ target\n${body}`, args: [],
  policy: name === "backward-second-hunk" ? "conflict" : "syntax",
}));

const syntaxProfiles: Fixture[] = ["backward-second-hunk", "missing-new-body"].flatMap(name =>
  ["backup", "no-backup"].map(profile => ({
    id: `syntax-options/${name}/${profile}`, family: "syntax-cohort", files: syntaxFiles, links: {},
    input: `${first}--- target\n+++ target\n${malformed[name]}`, args: profile === "backup" ? ["--backup-if-mismatch"] : ["--no-backup-if-mismatch"],
    policy: name === "backward-second-hunk" ? "conflict" : "syntax",
  })));

const quoteFiles = { first: "old\n", target: "old\n", "dir/target": "old\n" };
const quotedFixtures: Fixture[] = [false, true].flatMap(retained => ["default", "backup", "no-backup"].map(profile => ({
  id: `quoted-ancestor/${retained ? "p0-retained" : "default-basename"}/${profile}`,
  family: "quoted-selection", files: quoteFiles, links: { alias: "dir" },
  input: replacement("first") + replacement('"alias/target"'),
  args: [...(retained ? ["-p0"] : []), ...(profile === "backup" ? ["--backup-if-mismatch"] : profile === "no-backup" ? ["--no-backup-if-mismatch"] : [])],
  policy: retained ? "selected-path" : "apply",
})));

export const fixtures: readonly Fixture[] = [
  ...syntaxFixtures, ...syntaxProfiles, ...quotedFixtures,
  { id: "quoted-final/selected-alias", family: "quoted-selection", files: quoteFiles, links: { alias: "target" },
    input: replacement("first") + replacement('"alias"'), args: [], policy: "selected-path" },
  { id: "quoted-basename/selected-target-is-symlink", family: "quoted-selection",
    files: { first: "old\n", "dir/target": "old\n", referent: "old\n" }, links: { alias: "dir", target: "referent" },
    input: replacement("first") + replacement('"alias/target"'), args: [], policy: "selected-path" },
  { id: "selected-backup/symlink", family: "selected-output", files: { ...syntaxFiles, sentinel: "backup sentinel\n" },
    links: { "target.orig": "sentinel" }, input: `${first}--- target\n+++ target\n${malformed["backward-second-hunk"]}`,
    args: [], policy: "selected-path" },
  { id: "selected-reject/symlink", family: "selected-output", files: { ...syntaxFiles, sentinel: "reject sentinel\n" },
    links: { "target.rej": "sentinel" }, input: `${first}--- target\n+++ target\n${malformed["backward-second-hunk"]}`,
    args: [], policy: "selected-path" },
];

assert.equal(fixtures.length, 31);
assert.equal(new Set(fixtures.map(fixture => fixture.id)).size, fixtures.length);
