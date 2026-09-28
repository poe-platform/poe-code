import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createBaseCommand } from "./base.js";
test("portable engine preserves standard output bytes", async () => { let output = ""; const definition = createBaseCommand("base64", Infinity); const result = await definition.execute({ command: definition.name, args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource("hello"), stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }, signal: new AbortController().signal }); assert.equal(result.exitCode, 0); assert.equal(output, "aGVsbG8=\n"); });
