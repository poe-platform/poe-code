import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOpCompletion } from "./completion-resolver.js";

const itemCommands = ["create", "delete", "edit", "get", "list", "move", "share", "template"];
const values = (words: readonly string[], channel: "stable" | "beta" = "stable") => resolveOpCompletion(words, channel).candidates.map(candidate => candidate.value);

test("native command completion survives interspersed globals and command-looking flag values", () => {
  for (const words of [["item", ""], ["--account", "work", "item", ""], ["item", "--account=work", ""], ["item", "--account", "get", ""]]) {
    assert.deepEqual(values(words), itemCommands);
    assert.equal(resolveOpCompletion(words).directive, 4);
  }
});

test("native flag completion retains the leaf after operands and suppresses used and hidden flags", () => {
  assert.deepEqual(values(["item", "get", "example", "--"]), ["--account", "--cache", "--config", "--debug", "--encoding", "--format", "--iso-timestamps", "--no-color", "--session", "--fields", "--help", "--include-archive", "--otp", "--reveal", "--share-link", "--vault"]);
  assert.equal(values(["item", "get", "--reveal", "--"]).includes("--reveal"), false);
  assert.equal(values(["item", "get", "--vault=work", "--"]).includes("--vault"), false);
  assert.equal(values(["item", "get", "--field", "username", "--"]).includes("--fields"), true);
  assert.equal(values(["service-account", "create", "--vault=a,r", "--"]).includes("--vault"), true);
});

test("aliases parse without being advertised, and shorthand attached values preserve context", () => {
  assert.deepEqual(values(["item", "l"]), ["list"]);
  assert.deepEqual(values(["item", "r"]), []);
  assert.deepEqual(values(["item", "rm", "--"]), values(["item", "delete", "--"]));
  assert.equal(values(["read", "-ooutput", "--"]).includes("--out-file"), false);
  assert.equal(values(["read", "-n", "--"]).includes("--no-newline"), false);
});

test("native value slots, invalid input and child argv use fallback without reflecting user input", () => {
  for (const words of [["item", "get", "--vault", ""], ["item", "get", "--vault=wo"], ["run", "--", "item", ""], ["item", "get", "example", ""], ["item", "--bogus-secret", ""], ["--format=bogus", "item", ""]]) {
    assert.deepEqual(resolveOpCompletion(words), { candidates: [], directive: 0 });
  }
  assert.equal(values(["item", "get", "--vault", "--help", "--"]).includes("--help"), true);
});

test("help presence suppresses completion even false or clustered; root version is root-only", () => {
  for (const words of [["read", "-hn", ""], ["item", "get", "--help=false", "--"], ["--version=false", ""]]) {
    assert.deepEqual(resolveOpCompletion(words), { candidates: [], directive: 4 });
  }
  assert.ok(values(["--"]).includes("--version"));
  assert.equal(values(["item", "--"]).includes("--version"), false);
  assert.ok(values(["-"]).includes("-v"));
});

test("channel metadata controls beta suggestions while retaining local snapshot extension", () => {
  assert.deepEqual(values(["environment", ""]), ["snapshot"]);
  assert.deepEqual(values(["environment", ""], "beta"), ["read", "snapshot"]);
  assert.equal(values(["run", "--"]).includes("--environment"), false);
  assert.equal(values(["run", "--"], "beta").includes("--environment"), true);
  assert.equal(values([""]).includes("__complete"), false);
});
