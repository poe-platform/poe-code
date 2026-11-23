import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { agent } from "./agent.js";
import { createAgentRuntime } from "./runtime/filesystem.js";
import skillsPlugin from "./plugins/poe-agent-plugin-skills.js";
import { toAcpModelResponse } from "./testing/model-response.js";

const bytes = (text: string) => new TextEncoder().encode(text);

it("loads user and system skills from configured roots, including same-name skills", async () => {
  const fs = createMemoryFileSystem();
  const files = {
    "/work/.agents/skills/report/SKILL.md": "---\nname: report\ndescription: USER_REPORT\n---\nUSER_BODY",
    "/work/.agents/skills/.system/creator/SKILL.md": "---\nname: creator\ndescription: SYSTEM_CREATOR\n---\nSYSTEM_BODY",
    "/work/.agents/skills/.system/review/SKILL.md": "---\nname: review\ndescription: SYSTEM_REVIEW\n---",
    "/home/user/.agents/skills/review/SKILL.md": "---\nname: review\ndescription: USER_REVIEW\n---"
  };
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(file, bytes(content));
  }
  const runtime = createAgentRuntime({ fs, cwd: "/work" }, new AbortController().signal);
  const directories = [".agents/skills", "/home/user/.agents/skills"];
  const plugin = skillsPlugin({ directories });
  const prompt = { system: "BASE_SYSTEM", userPrompt: "hello" };
  const first = await plugin.prompt!(prompt, runtime);
  expect(first.system).toContain("BASE_SYSTEM");
  expect(first.system).toContain("USER_REPORT");
  expect(first.system).toContain("SYSTEM_CREATOR");
  expect(first.system).toContain("USER_REVIEW");
  expect(first.system).toContain("SYSTEM_REVIEW");
  expect(first.system).toContain("/work/.agents/skills/.system/creator/SKILL.md");
  expect(first.system).not.toContain("USER_BODY");
  expect(first.system).not.toContain("SYSTEM_BODY");
  expect(first.system).not.toContain("Duplicate skill name: review");
  const explicitSystem = skillsPlugin({ directories: [...directories, ".agents/skills/.system"] });
  expect((await explicitSystem.prompt!(prompt, runtime)).system?.split("- creator:")).toHaveLength(2);

  await fs.writeFile("/work/.agents/skills/.system/creator/SKILL.md", bytes("---\ndescription: UPDATED_SYSTEM_CREATOR\n---"));
  expect((await plugin.prompt!(prompt, runtime)).system).toContain("UPDATED_SYSTEM_CREATOR");
  await fs.unlink("/work/.agents/skills/.system/creator/SKILL.md");
  expect((await plugin.prompt!(prompt, runtime)).system).not.toContain("SYSTEM_CREATOR");
});

it("loads a system-only root and skips missing roots", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/skills/.system/creator", { recursive: true });
  await fs.writeFile("/skills/.system/creator/SKILL.md", bytes("---\ndescription: SYSTEM_ONLY\n---"));
  const runtime = createAgentRuntime({ fs, cwd: "/" }, new AbortController().signal);
  const plugin = skillsPlugin({ directories: ["/missing", "/skills"] });
  expect((await plugin.prompt!({ userPrompt: "hello" }, runtime)).system).toContain("SYSTEM_ONLY");
});

it("rejects a symlinked system directory", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/skills", { recursive: true });
  await fs.mkdir("/outside/creator", { recursive: true });
  await fs.writeFile("/outside/creator/SKILL.md", bytes("UNTRUSTED_BODY"));
  await fs.symlink("/outside", "/skills/.system");
  const runtime = createAgentRuntime({ fs, cwd: "/" }, new AbortController().signal);
  const plugin = skillsPlugin({ directories: ["/skills"] });
  await expect(plugin.prompt!({ userPrompt: "hello" }, runtime)).rejects.toThrow("symbolic link");
});

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
      expect(system).toContain("- weekly-report:");
      expect(system).toContain("<skills_instructions>");
      expect(system).toContain("### Available skills");
      expect(system).not.toContain("Available file skills:");
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
