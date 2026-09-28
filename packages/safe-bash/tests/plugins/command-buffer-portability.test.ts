import assert from "node:assert/strict";
import test from "node:test";
import { xanCommands } from "../../src/commands/xan/index.js";
import { networkCommands } from "../../src/commands/network/public.js";
import { toByteSource } from "../../src/contracts/index.js";
import { Shell, MemoryFileSystem, agentCommands, createAgentCommands } from "../../src/index.js";

test("command families preserve results without the global Buffer", async () => {
  new Request("https://example.test");
  const scripts = [
    "jq -r .name /data.json", "diff -u /a /b", "stat -c %s /a", "mktemp -u /tmp/item.XXXXXX",
    "file /a", "column -t /a", "du --apparent-size /a", "expr 1 + 2", "nl /a", "seq 1 3",
    "tac /a", "sed 's/hello/hi/' /a", "awk '{print $1}' /a", "rg hello /a", "grep hello /a",
    "date -u -d 2020-01-01 +%Y", "printenv HOME", "split -l 1 /a /part", "tree /", "cut -c 1-3 /a",
    "tar -cf /out.tar /a && tar -tf /out.tar", "zip -q /out.zip /a && unzip -l /out.zip",
    "printf 'é\\n' | sort | uniq | wc -c", "printf 'a b\\na c\\n' | cut -d ' ' -f 2",
    "find / -type f", "printf abc | tr a-z A-Z", "printf abc | xargs echo",
    "printf 'x,y\\n1,2\\n' | xan count", "printf '<p>Hello</p>' | html-to-markdown",
    "curl -sS -u é:pw https://example.test/data", "wget -q -O - https://example.test/data",
    "printf '%s' '--- /a\n+++ /a\n@@ -1,2 +1,2 @@\n-hello é\n+hi é\n world\n' | patch /a && cat /a",
    "printf '%s' '*** Begin Patch\n*** Add File: /added\n+added é\n*** End Patch\n' | apply_patch && cat /added",
  ];
  const execute = async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/tmp", { recursive: true });
    for (const [path, text] of [["/a", "hello é\nworld\n"], ["/b", "hello é\nthere\n"], ["/data.json", '{"name":"é"}']]) {
      await fs.writeFile(path!, new TextEncoder().encode(text!));
      await fs.utimes(path!, 0, Date.UTC(2020, 0, 1));
    }
    const shell = new Shell({ fs, env: { HOME: "/home" } }).use(agentCommands()).use(xanCommands()).use(networkCommands({
      authorize: () => true,
      transport: async () => ({ status: 200, statusText: "OK", headers: [], body: toByteSource(Uint8Array.of(0, 255, 65)), async dispose() {} }),
    }));
    try {
      const results = [];
      for (const script of scripts) {
        const result = await shell.exec(script);
        assert.equal(result.exitCode, script.startsWith("diff ") ? 1 : 0, `${script}: ${result.stderr}`);
        results.push({ script, exitCode: result.exitCode, stdout: script.startsWith("mktemp") ? "" : result.stdout, stdoutBytes: script.startsWith("mktemp") ? new Uint8Array() : result.stdoutBytes, stderr: result.stderr });
      }
      for (const command of createAgentCommands()) {
        const result = await shell.exec(`${command.name} --help`);
        assert.ok(!result.stderr.includes("internal error"), `${command.name} --help: ${result.stderr}`);
        results.push({ script: `${command.name} --help`, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
      }
      return results;
    } finally { await shell.dispose(); }
  };
  const expected = await execute();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Reflect.deleteProperty(globalThis, "Buffer");
  try { assert.deepEqual(await execute(), expected); assert.equal(globalThis.Buffer, undefined); }
  finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
});
