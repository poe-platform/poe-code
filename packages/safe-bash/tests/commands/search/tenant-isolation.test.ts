import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "../../shell/helpers.js";
import { rgCommand } from "../../../src/commands/search/rg.js";
import { grepCommands } from "../../../src/commands/grep.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";

const tools = ["rg", "rg -F", "grep -E", "grep -F", "sed", "awk"] as const;
for (const size of [8, 140]) for (const tool of [...tools, "mixed", "mixed-stream"]) {
  test(`24 concurrent Shell tenants preserve ${tool} output (${size} records)`, async () => {
    const tenants = await Promise.all(Array.from({ length: 24 }, async (_, id) => {
      const tenant = setup();
      tenant.commands.register(rgCommand());
      for (const command of grepCommands()) tenant.commands.register(command);
      for (const command of createTextProgramCommands()) tenant.commands.register(command);
      const secret = `TENANT_${id}_${"x".repeat(id)}`;
      const contents = Array.from({ length: size }, (_, line) => `${secret}_line_${line}|val=${line}\n`).join("");
      await tenant.fs.mkdir("/work/sub", { recursive: true });
      await tenant.fs.writeFile("/work/sub/input", Buffer.from(contents));
      return { ...tenant, secret, contents, selectedTool: tool.startsWith("mixed") ? tools[id % tools.length]! : tool };
    }));
    try {
      const results = await Promise.allSettled(tenants.map(async ({ shell, fs, secret, contents, selectedTool }) => {
        const file = tool === "mixed-stream" ? "-" : selectedTool.startsWith("rg") ? "/work/sub" : "/work/sub/input";
        const command = selectedTool === "sed" ? `sed 's/TENANT/REPLACED/' ${file}`
          : selectedTool === "awk" ? `awk '{ print $0 }' ${file}`
          : `${selectedTool}${selectedTool.startsWith("rg") ? " -I" : ""} '${secret}' ${file}`;
        const expected = selectedTool === "sed" ? contents.replaceAll("TENANT", "REPLACED") : contents;
        const options = tool === "mixed-stream" ? { stdin: (async function* () {
          for (let start = 0; start < contents.length; start += 37) yield Buffer.from(contents.slice(start, start + 37));
        })() } : {};
        const result = await shell.exec(`${command} > /work/output`, options);
        assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
        assert.equal(result.stderr, "", command);
        assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), expected, command);
      }));
      for (const result of results) if (result.status === "rejected") throw result.reason;
    } finally {
      await Promise.all(tenants.map(({ shell }) => shell.dispose()));
    }
  });
}
