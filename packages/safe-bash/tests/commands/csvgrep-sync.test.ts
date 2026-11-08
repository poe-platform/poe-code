import test from "node:test";
import assert from "node:assert/strict";
import { evalSyncCsvgrep } from "../../src/commands/csvgrep/index.js";

test("csvgrep synchronous match files strip Python whitespace on terminated and final lines", () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  for (const ending of ["", "\n", "\r\n"]) {
    const result = evalSyncCsvgrep(
      encode("name\nalpha\nbeta\ngamma\n"),
      ["-c", "name", "-f", "matches"],
      (path) => {
        assert.equal(path, "matches");
        return encode("alpha \u00a0\r\nbeta\t\u001c" + ending);
      },
    );
    assert.equal(result, "name\nalpha\nbeta\n");
  }
});
