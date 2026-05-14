const assert = require("node:assert/strict");

const designSystem = require("../dist/index.js");

assert.equal(typeof designSystem.runExplorer, "function");
assert.equal(typeof designSystem.singleDetail, "function");
assert.equal(typeof designSystem.explorer, "object");
assert.equal(typeof designSystem.explorer.runExplorer, "function");
assert.equal(typeof designSystem.explorer.singleDetail, "function");
