import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { run } from "./helpers.js";

// Captured independently with /usr/bin/jq 1.7.1, LC_ALL=C.
const cases = [
  {
    "input": "\"banana\"\n",
    "filter": "gsub(\"a\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"bXnXnX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"banana\"\n",
    "filter": "gsub(\"z\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"banana\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XaXbXcX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"ab\"\n",
    "filter": "gsub(\"a*\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XXbX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"ab\"\n",
    "filter": "gsub(\"a|ab\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"Xb\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"aaa\"\n",
    "filter": "gsub(\"a+?\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XXX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a1b22\"\n",
    "filter": "gsub(\"[0-9]+\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"aXbX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a1b22\"\n",
    "filter": "gsub(\"(?<n>[0-9]+)\";.n)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"a1b22\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a1b22\"\n",
    "filter": "gsub(\"(?<n>[0-9]+)\";\"<\" + .n + \">\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"a<1>b<22>\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"😀é😀\"\n",
    "filter": "gsub(\".\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XXX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a\\nb\"\n",
    "filter": "gsub(\".\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"X\\nX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a\\nb\"\n",
    "filter": "gsub(\".\";\"X\";\"m\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XXX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a\\nb\"\n",
    "filter": "gsub(\"^\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"Xa\\nb\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"BanAna\"\n",
    "filter": "gsub(\"a\";\"X\";\"i\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"BXnXnX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"aa\"\n",
    "filter": "gsub(\"a\";(\"X\",\"Y\"))",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XX\"\n\"YY\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"z\";1/0)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"abc\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"a\";empty)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"abc\"\n",
      "stderr": ""
    }
  },
  {
    "input": "12\n",
    "filter": "gsub(\"a\";\"X\")",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): number (12) cannot be matched, as it is not a string\n"
    }
  },
  {
    "input": "\"a\"\n",
    "filter": "gsub(12;\"X\")",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): number (12) is not a string\n"
    }
  },
  {
    "input": "\"a\"\n",
    "filter": "gsub(\"a\";12)",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): string (\"\") and number (12) cannot be added\n"
    }
  },
  {
    "input": "\"a\"\n",
    "filter": "gsub(\"[\";\"X\")",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Regex failure: premature end of char-class\n"
    }
  },
  {
    "input": "\"a\"\n",
    "filter": "gsub(\"a\";\"X\";\"q\")",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): qg is not a valid modifier string\n"
    }
  },
  {
    "input": "\"ab\"\n",
    "filter": "gsub(\"(?<x>.)\";if .x == \"a\" then (\"X\",\"Y\") else \"Z\" end)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XZ\"\n\"Y\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"ab\"\n",
    "filter": "gsub(\"(?<x>.)\";if .x == \"a\" then \"X\" else (\"Y\",\"Z\") end)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"XY\"\n\"Z\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"aab\"\n",
    "filter": "gsub(\"(a)\\\\1\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"Xb\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"[\";\"X\")",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Regex failure: premature end of char-class\n"
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"a\";\"X\";\"n\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"Xbc\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"(\";\"X\")",
    "expected": {
      "exitCode": 5,
      "stdout": "",
      "stderr": "jq: error (at <stdin>:1): Regex failure: end pattern with unmatched parenthesis\n"
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\"\\\\d\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"abc\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a\\nb\\n\"\n",
    "filter": "gsub(\"$\";\"X\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"a\\nbX\\nX\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"abc\"\n",
    "filter": "gsub(\".\";\"$&\")",
    "expected": {
      "exitCode": 0,
      "stdout": "\"$&$&$&\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"ab\"\n",
    "filter": "gsub(\"(?<x>a)?b\";.x)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"a\"\n",
      "stderr": ""
    }
  },
  {
    "input": "\"a\"\n",
    "filter": "gsub(\"a\";null)",
    "expected": {
      "exitCode": 0,
      "stdout": "\"\"\n",
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

test("gsub charges regex work and hidden replacement values", async () => {
  for (const [filter, limits, message] of [
    ['gsub("(a+)+b";"X")? | empty', { maxSteps: 200 }, "maxSteps"],
    ['gsub("a";"xxxxxxxxxxxxxxxx") | empty', { maxValueBytes: 10 }, "maxValueBytes"],
  ] as const) {
    const result = await run(["-c", filter], JSON.stringify(message === "maxSteps" ? "a".repeat(30) : "aa"), { limits });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stderr, `jq: ${message} limit exceeded\n`);
  }
});
