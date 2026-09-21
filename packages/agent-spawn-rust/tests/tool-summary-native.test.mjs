import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeToolAction as own } from "../dist/tool-summary.js";
import { summarizeToolAction as original } from "../../agent-spawn/dist/acp/tool-summary.js";
test("owned summaries preserve private input receivers, cyclic extras and UTF-16 paths", () => {
  class Input {
    #command = "cat \ud800/readme";
    get command() {
      return this.#command;
    }
    get path() {
      return "folder/🌍";
    }
    get query() {
      return "needle";
    }
  }
  const input = new Input();
  input.self = input;
  for (const kind of ["exec", "execute", "search", "read", "other", "constructor", "__proto__"])
    for (const title of [
      "mcp__board__list_tasks",
      "browser.takeScreenshot",
      "unsafe\nname\x1b[31m\ud800"
    ]) {
      const tool = { kind, title, input };
      assert.deepEqual(own(tool), original(tool));
    }
  const prefix = "cat ",
    path = "🌍".repeat(120);
  assert.deepEqual(
    own({ kind: "exec", title: prefix + path }),
    original({ kind: "exec", title: prefix + path })
  );
});
test("quoted operators, literal variables and unsupported shell shapes match reference labels", () => {
  for (const title of [
    "cat $HOME/file",
    "cat ${HOME}/file",
    "cat ${HOME:-${TMP}}/file",
    "cat '${HOME}'",
    'cat "$?suffix"',
    "cat '$HOME'",
    "cat one\\ two",
    "cat one*",
    "cat escaped\\*",
    "cat foo#comment",
    "cat foo #comment",
    "cat one | head -30",
    "cat one | tail -n 3 file",
    "rg --files | sort -ru",
    "rg --files | sort -roout",
    'cat "unterminated',
    "cat 'unterminated",
    "cat one\\",
    "zsh -lc 'bash -c \"cat one\"'",
    "sed -n '1,$p' -- -notes"
  ]) {
    assert.deepEqual(own({ kind: "exec", title }), original({ kind: "exec", title }), title);
  }
});
