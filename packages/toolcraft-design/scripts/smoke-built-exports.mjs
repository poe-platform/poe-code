import assert from "node:assert/strict";
import * as designSystem from "../dist/index.js";

assert.equal(typeof designSystem.runExplorer, "function");
assert.equal(typeof designSystem.singleDetail, "function");
assert.equal(typeof designSystem.explorer, "object");
assert.equal(typeof designSystem.explorer.runExplorer, "function");
assert.equal(typeof designSystem.explorer.singleDetail, "function");
assert.equal(typeof designSystem.renderCatalog, "function");
assert.equal(typeof designSystem.stripAnsi, "function");
