import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { run } from "./helpers.js";

// Frozen differential results from /usr/bin/jq 1.7.1, LC_ALL=C.
const cases = [
  {
    "input": "{}\n",
    "filter": "setpath([\"a\",0];5)",
    "expected": {
      "exitCode": 0,
      "stdout": "{\"a\":[5]}\n",
      "stderr": ""
    }
  },
  {
    "input": "null\n",
    "filter": "setpath([\"a\",2,\"b\"];5)",
    "expected": {
      "exitCode": 0,
      "stdout": "{\"a\":[null,null,{\"b\":5}]}\n",
      "stderr": ""
    }
  },
  {
    "input": "[1,2]\n",
    "filter": "setpath([-1];5)",
    "expected": {
      "exitCode": 0,
      "stdout": "[1,5]\n",
      "stderr": ""
    }
  },
  {
    "input": "[1,2]\n",
    "filter": "setpath([1.8];5)",
    "expected": {
      "exitCode": 0,
      "stdout": "[1,5]\n",
      "stderr": ""
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath([];[1,2])",
    "expected": {
      "exitCode": 0,
      "stdout": "[1,2]\n",
      "stderr": ""
    }
  },
  {
    "input": "{\"a\":1}\n",
    "filter": "[.,setpath([\"a\"];2),.]",
    "expected": {
      "exitCode": 0,
      "stdout": "[{\"a\":1},{\"a\":2},{\"a\":1}]\n",
      "stderr": ""
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath(([\"a\"],[\"b\"]);(1,2))",
    "expected": {
      "exitCode": 0,
      "stdout": "{\"a\":1}\n{\"b\":1}\n{\"a\":2}\n{\"b\":2}\n",
      "stderr": ""
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath(null;empty)",
    "expected": {
      "exitCode": 0,
      "stdout": "",
      "stderr": ""
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath(null;5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Path must be specified as an array\n"
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath([true];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Cannot index object with boolean\n"
    }
  },
  {
    "input": "1\n",
    "filter": "setpath([\"a\"];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Cannot index number with string \"a\"\n"
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath([0];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Cannot index object with number\n"
    }
  },
  {
    "input": "[]\n",
    "filter": "setpath([\"a\"];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Cannot index array with string \"a\"\n"
    }
  },
  {
    "input": "null\n",
    "filter": "setpath([-1];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Out of bounds negative array index\n"
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath([\"a\",-1];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Out of bounds negative array index\n"
    }
  },
  {
    "input": "null\n",
    "filter": "setpath([null];5)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Cannot index null with null\n"
    }
  },
  {
    "input": "{}\n",
    "filter": "setpath([\"__proto__\",\"polluted\"];5)",
    "expected": {
      "exitCode": 0,
      "stdout": "{\"__proto__\":{\"polluted\":5}}\n",
      "stderr": ""
    }
  }
];

for (const { input, filter, expected } of cases) {
  test(`jq ${filter} on ${input.trim()}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(`jq -c '${filter}'`, { stdin: input });
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, expected);
    } finally { await shell.dispose(); }
  });
}

test("setpath checks array extension before allocation and cannot suppress limits", async () => {
  const result = await run(["-c", 'setpath([100001];5)?'], "null\n");
  assert.equal(result.exitCode, 5);
  assert.equal(result.stderr, "jq: maxCollectionSize limit exceeded\n");
});
