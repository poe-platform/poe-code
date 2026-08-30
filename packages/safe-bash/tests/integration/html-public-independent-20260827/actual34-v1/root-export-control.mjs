import assert from "node:assert/strict";
await assert.rejects(import("virtual-bash"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
console.log("BOUNDARY:MISSING_ROOT_EXPORT");
