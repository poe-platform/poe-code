import assert from "node:assert/strict";
import test from "node:test";
import { posixPath } from "../../src/contracts/path.js";
import { posixPath as nodePath } from "../../src/contracts/node.js";
import { posixPath as nodePathContract } from "../../src/contracts/node-path.js";

test("node contracts expose the portable virtual path implementation", () => {
  assert.equal(nodePath, posixPath);
  assert.equal(nodePathContract, posixPath);
  assert.equal(nodePath.resolve("/workspace", "../data/file.js"), "/data/file.js");
});
