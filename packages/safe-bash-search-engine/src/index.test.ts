import assert from "node:assert/strict";
import { test } from "node:test";
import { count } from "./options.js";
test("search counts reject invalid and unsafe values", () => { assert.equal(count("12", "-m"), 12); assert.throws(() => count("oops", "-m")); assert.throws(() => count("9007199254740992", "-m")); });
