import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled yq native-profile repairs", { skip: selected === undefined ? "Requires build:optional and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  const cases = [
    {
      name: "JSON preserves duplicate members and numeric-looking key order",
      command: "yq -p=json -o=json -I=0 .",
      input: '{"10":1,"2":2,"a":3,"a":4,"__proto__":5}',
      stdout: '{"10":1,"2":2,"a":3,"a":4,"__proto__":5}\n',
    },
    {
      name: "unindented quoted YAML continuation preserves style",
      command: "yq .", input: 'a: "hello\nworld"\n', stdout: 'a: "hello world"\n',
    },
    {
      name: "wildcard matching counts the original UTF-8 bytes",
      command: 'yq \'.a == "f????o"\'', input: "a: f😀o\n", stdout: "true\n",
    },
    {
      name: "hexadecimal addition retains the scalar spelling convention",
      command: "yq '.a += 1'", input: "a: 0x10\n", stdout: "a: 0x11\n",
    },
    {
      name: "large JSON integers follow native decoding and encoding",
      command: "yq -p=json -o=json -I=0 .",
      input: '{"a":9007199254740993,"a":9223372036854775807}',
      stdout: '{"a":9007199254740992,"a":9223372036854775807}\n',
    },
    {
      name: "JSON exponent spelling follows the native formatter",
      command: "yq -p=json -o=json -I=0 .",
      input: "[-0,1e2,1.0,1e-7]", stdout: "[0,100,1,1e-07]\n",
    },
    {
      name: "native permissive JSON object parsing retains both members",
      command: "yq -p=json .", input: '{"a":1 "b":2}', stdout: "a: 1\nb: 2\n",
    },
    {
      name: "unpaired JSON surrogates normalize to a replacement character",
      command: "yq -p=json -o=json .", input: '{"a":"\\ud800"}', stdout: '{\n  "a": "�"\n}\n',
    },
    {
      name: "custom tagged exponent addition uses native numeric coercion",
      command: "yq '.a + .b'", input: "a: !number 1e3\nb: 1\n", stdout: "1001\n",
    },
    {
      name: "custom tagged hexadecimal addition retains native spelling",
      command: "yq '.a + .b'", input: "a: !number 0x10\nb: 1\n", stdout: "0x11\n",
    },
    {
      name: "multiline quoted keys retain the exact native diagnostic",
      command: "yq .", input: '"one\ntwo": "three\nfour"\n', stdout: "", status: 1,
      stderr: "Error: bad file '-': yaml: line 2, column 5: mapping values are not allowed in this context\n",
    },
  ];
  for (const fixture of cases) {
    test(fixture.name, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as { yqCommands(): import("poe-code/safe-bash").VirtualShellPlugin };
      const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(optional.yqCommands());
      try {
        const result = await shell.exec(fixture.command, { stdin: fixture.input });
        assert.equal(result.exitCode, fixture.status ?? 0, result.stderr);
        assert.equal(result.stdout, fixture.stdout);
        assert.equal(result.stderr, fixture.stderr ?? "");
      } finally { await shell.dispose(); }
    });
  }

  test("a later malformed JSON value retains earlier public stdout", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as { yqCommands(): import("poe-code/safe-bash").VirtualShellPlugin };
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(optional.yqCommands());
    try {
      const result = await shell.exec("yq -p=json -o=json -I=0 .", { stdin: '{"a":1}\n{"x":}' });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '{"a":1}\n');
      assert.equal(result.stderr, "Error: bad file '-': json: value of object unexpected end of JSON input\n");
    } finally { await shell.dispose(); }
  });
});
