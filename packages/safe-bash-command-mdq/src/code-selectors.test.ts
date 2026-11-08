import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { mdq } from "./index.js";

// Captured independently from native mdq v0.10.0, including valid controls.
const fixtures = [
  {
    "argv": [
      "-o",
      "markdown",
      "``` /a/ b"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | ``` /a/ b\n  |         ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "json",
      "``` /a/ b"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | ``` /a/ b\n  |         ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "markdown",
      "``` /a/ /b/"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | ``` /a/ /b/\n  |         ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "json",
      "``` /a/ /b/"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:9\n  |\n1 | ``` /a/ /b/\n  |         ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "markdown",
      "```js /a/ b"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:11\n  |\n1 | ```js /a/ b\n  |           ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "json",
      "```js /a/ b"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 1:11\n  |\n1 | ```js /a/ b\n  |           ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "markdown",
      "``` /a/\n b"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 2:2\n  |\n2 |  b\n  |  ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "json",
      "``` /a/\n b"
    ],
    "stdin": "",
    "exitCode": 1,
    "stdout": "",
    "stderr": "Syntax error in select specifier:\n --> 2:2\n  |\n2 |  b\n  |  ^---\n  |\n  = expected end of input\n"
  },
  {
    "argv": [
      "-o",
      "markdown",
      "``` /a/"
    ],
    "stdin": "```js\nax\n```\n",
    "exitCode": 0,
    "stdout": "```js\nax\n```\n",
    "stderr": ""
  },
  {
    "argv": [
      "-o",
      "json",
      "``` /a/"
    ],
    "stdin": "```js\nax\n```\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"code_block\":{\"code\":\"ax\",\"type\":\"code\",\"language\":\"js\"}}]}",
    "stderr": ""
  },
  {
    "argv": [
      "-o",
      "markdown",
      "```js x"
    ],
    "stdin": "```js\nax\n```\n",
    "exitCode": 0,
    "stdout": "```js\nax\n```\n",
    "stderr": ""
  },
  {
    "argv": [
      "-o",
      "json",
      "```js x"
    ],
    "stdin": "```js\nax\n```\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"code_block\":{\"code\":\"ax\",\"type\":\"code\",\"language\":\"js\"}}]}",
    "stderr": ""
  },
  {
    "argv": [
      "-o",
      "markdown",
      "``` /a/ | ```"
    ],
    "stdin": "```js\nax\n```\n",
    "exitCode": 0,
    "stdout": "```js\nax\n```\n",
    "stderr": ""
  },
  {
    "argv": [
      "-o",
      "json",
      "``` /a/ | ```"
    ],
    "stdin": "```js\nax\n```\n",
    "exitCode": 0,
    "stdout": "{\"items\":[{\"code_block\":{\"code\":\"ax\",\"type\":\"code\",\"language\":\"js\"}}]}",
    "stderr": ""
  }
];

for (const fixture of fixtures) test(`code selector ${JSON.stringify(fixture.argv)}`, async () => {
  let stdout = "", stderr = "";
  const result = await mdq({
    command: "mdq", args: fixture.argv, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: toByteSource(new TextEncoder().encode(fixture.stdin)),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, fixture.exitCode);
  assert.equal(stdout, fixture.stdout);
  assert.equal(stderr, fixture.stderr);
});
