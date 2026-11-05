import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { agent } from "./agent.js";
import { createAgentRuntime } from "./runtime/filesystem.js";
import skillsPlugin from "./plugins/poe-agent-plugin-skills.js";
import { toAcpModelResponse } from "./testing/model-response.js";

const bytes = (text: string) => new TextEncoder().encode(text);

it("refreshes metadata after a tool edit and resume without putting skill bodies in the prompt", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/skills/report", { recursive: true });
  await fs.mkdir("/skills/private", { recursive: true });
  const file = "/skills/report/SKILL.md";
  await fs.writeFile(file, bytes("---\nname: weekly-report\ndescription: Prepare <weekly> reports & summaries\n---\nBODY_MARKER"));
  await fs.writeFile("/skills/private/SKILL.md", bytes("---\ndescription: HIDDEN_DESCRIPTION\ndisable-model-invocation: true\n---\nPRIVATE_BODY"));
  const bot = agent({ fs, cwd: "/" })
    .use(skillsPlugin({ directories: ["/skills"] }))
    .tools({ name: "read_and_edit", async call() {
      const body = new TextDecoder().decode(await fs.readFile(file));
      await fs.writeFile(file, bytes("---\nname: weekly-report\ndescription: Updated description\n---\nBODY_MARKER"));
      return body;
    } });
  let calls = 0;
  const first = await bot.run("Prepare a report", {
    baseSystemPrompt: "BASE_SYSTEM",
    acpModel: { complete: async ({ messages, tools }) => {
      const systems = messages.filter(message => message.role === "system");
      const system = JSON.stringify(systems);
      expect(systems).toHaveLength(1);
      expect(system).toContain("BASE_SYSTEM");
      expect(system).toContain("<name>weekly-report</name>");
      expect(system).toContain(file);
      expect(system).not.toContain("BODY_MARKER");
      expect(system).not.toContain("HIDDEN_DESCRIPTION");
      expect(system).not.toContain("PRIVATE_BODY");
      expect(tools.map(tool => tool.name)).toEqual(["read_and_edit"]);
      if (++calls === 1) {
        expect(system).toContain("Prepare &lt;weekly&gt; reports &amp; summaries");
        return toAcpModelResponse({ content: "", toolCalls: [{ id: "read", name: "read_and_edit", args: {} }] });
      }
      expect(system).toContain("Updated description");
      expect(JSON.stringify(messages.filter(message => message.role === "tool"))).toContain("BODY_MARKER");
      return toAcpModelResponse({ content: "Done" });
    } }
  });
  expect(first.exitCode, first.stderr).toBe(0);
  expect(calls).toBe(2);
  await fs.unlink(file);
  const resumed = await bot.run("Continue", {
    baseSystemPrompt: "BASE_SYSTEM", resume: first,
    acpModel: { complete: async ({ messages }) => {
      const system = JSON.stringify(messages.filter(message => message.role === "system"));
      expect(system).toContain("BASE_SYSTEM");
      expect(system).not.toContain("weekly-report");
      expect(system).not.toContain("Updated description");
      expect(system).not.toContain("HIDDEN_DESCRIPTION");
      return toAcpModelResponse({ content: "Resumed" });
    } }
  });
  expect(resumed.exitCode, resumed.stderr).toBe(0);
});

it("isolates a shared plugin across filesystems and honors cancellation", async () => {
  const first = createMemoryFileSystem(), second = createMemoryFileSystem();
  await first.mkdir("/skills/report", { recursive: true });
  await first.writeFile("/skills/report/SKILL.md", bytes("---\ndescription: FIRST_ONLY\n---"));
  const plugin = skillsPlugin({ directories: ["/skills"] });
  const controller = new AbortController();
  const a = createAgentRuntime({ fs: first, cwd: "/" }, controller.signal);
  const b = createAgentRuntime({ fs: second, cwd: "/" }, controller.signal);
  const prompt = { system: "BASE_SYSTEM", userPrompt: "hello" };
  const outputs = await Promise.all([plugin.prompt!(prompt, a), plugin.prompt!(prompt, b)]);
  expect(outputs[0].system).toContain("FIRST_ONLY");
  expect(outputs[1].system).toBe("BASE_SYSTEM");
  expect(prompt).toEqual({ system: "BASE_SYSTEM", userPrompt: "hello" });
  controller.abort(new Error("cancelled"));
  await expect(plugin.prompt!(prompt, a)).rejects.toThrow("cancelled");
});
