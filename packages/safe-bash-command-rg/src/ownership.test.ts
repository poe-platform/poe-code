import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "./options.js";
import { defaultFileTypes } from "./file-types.js";
import { SearchError } from "safe-bash-search-engine/options";

test("rg owns type selection and option parsing with the canonical search error", () => {
  assert.ok(defaultFileTypes["ts"]);
  assert.deepEqual(parse(["-t", "ts", "needle", "/src"]).patterns, ["needle"]);
  assert.throws(() => parse(["--max-depth", "invalid", "needle"]), SearchError);
});
