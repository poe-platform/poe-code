import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import {
  resolveSkillReferenceAsync,
  bridgeActiveSkillsAsync,
  cleanupBridgedSkillsAsync
} from "./index.js";

it("discovers and bridges skills with cleanup and git excludes inside a virtual provider", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/workspace/.poe-code/skills/demo", { recursive: true });
  await fs.mkdir("/workspace/.git/info", { recursive: true });
  await fs.writeFile("/workspace/.git/info/exclude", new TextEncoder().encode("sentinel\n"));
  await fs.writeFile(
    "/workspace/.poe-code/skills/demo/SKILL.md",
    new TextEncoder().encode("# Demo\nVirtual skill.")
  );
  const options = { fs, cwd: "/workspace", homeDir: "/home", signal: new AbortController().signal };
  expect(await resolveSkillReferenceAsync("demo", options)).toMatchObject({
    kind: "resolved",
    scope: "project"
  });
  const manifest = await bridgeActiveSkillsAsync("claude", ["demo"], "probe", options);
  expect(
    new TextDecoder().decode(await fs.readFile("/workspace/.claude/skills/demo/SKILL.md"))
  ).toContain("Virtual skill");
  expect(new TextDecoder().decode(await fs.readFile("/workspace/.git/info/exclude"))).toContain(
    ".claude/skills/demo"
  );
  await cleanupBridgedSkillsAsync(manifest, options);
  await expect(fs.stat("/workspace/.claude/skills/demo")).rejects.toMatchObject({ code: "ENOENT" });
  expect(new TextDecoder().decode(await fs.readFile("/workspace/.git/info/exclude"))).toBe(
    "sentinel\n"
  );
});

it("shares bridge ownership and preserves skills modified by the caller", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/workspace/.poe-code/skills/demo", { recursive: true });
  await fs.writeFile("/workspace/.poe-code/skills/demo/SKILL.md", new TextEncoder().encode("original"));
  const options = { fs, cwd: "/workspace", homeDir: "/home" };
  const first = await bridgeActiveSkillsAsync("claude", ["demo"], "first", options);
  const second = await bridgeActiveSkillsAsync("claude", ["demo"], "second", options);
  expect(second.entries).toHaveLength(1);
  await cleanupBridgedSkillsAsync(first, options);
  expect((await fs.stat("/workspace/.claude/skills/demo")).type).toBe("directory");
  await fs.writeFile("/workspace/.claude/skills/demo/SKILL.md", new TextEncoder().encode("caller change"));
  await cleanupBridgedSkillsAsync(second, options);
  expect(new TextDecoder().decode(await fs.readFile("/workspace/.claude/skills/demo/SKILL.md"))).toBe("caller change");
  await cleanupBridgedSkillsAsync(second, options);
});

it("does not overwrite collisions or accept cleanup from a different provider", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/workspace/.poe-code/skills/demo", { recursive: true });
  await fs.mkdir("/workspace/.claude/skills/demo", { recursive: true });
  await fs.writeFile("/workspace/.poe-code/skills/demo/SKILL.md", new TextEncoder().encode("source"));
  await fs.writeFile("/workspace/.claude/skills/demo/SKILL.md", new TextEncoder().encode("sentinel"));
  const options = { fs, cwd: "/workspace", homeDir: "/home" };
  const manifest = await bridgeActiveSkillsAsync("claude", ["demo"], "collision", options);
  expect(manifest.warnings[0].kind).toBe("local-collision");
  await expect(cleanupBridgedSkillsAsync(manifest, { ...options, fs: createMemoryFileSystem() })).rejects.toThrow("filesystem conflicts");
  await cleanupBridgedSkillsAsync(manifest, options);
  expect(new TextDecoder().decode(await fs.readFile("/workspace/.claude/skills/demo/SKILL.md"))).toBe("sentinel");
});

it("rolls back its own partially copied target when cancellation arrives", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/workspace/.poe-code/skills/demo", { recursive: true });
  await backing.writeFile("/workspace/.poe-code/skills/demo/SKILL.md", new TextEncoder().encode("source"));
  const controller = new AbortController();
  const fs: import("@poe-code/safe-fs").FileSystem = {
    ...backing,
    // Prototype methods are retained through the original provider.
    capabilities: backing.capabilities,
    readFile: backing.readFile.bind(backing),
    stat: backing.stat.bind(backing), lstat: backing.lstat.bind(backing),
    readdir: backing.readdir.bind(backing), mkdir: backing.mkdir.bind(backing),
    rename: backing.rename.bind(backing), rm: backing.rm.bind(backing),
    rmdir: backing.rmdir!.bind(backing), unlink: backing.unlink!.bind(backing),
    writeFile: backing.writeFile.bind(backing),
    copyFile: async (source, destination, options) => {
      await backing.copyFile(source, destination, options);
      if (destination === "/workspace/.claude/skills/demo/SKILL.md") controller.abort(new Error("cancel copy"));
    }
  };
  await expect(bridgeActiveSkillsAsync("claude", ["demo"], "cancelled", {
    fs, cwd: "/workspace", homeDir: "/home", signal: controller.signal
  })).rejects.toMatchObject({ name: "AbortError" });
  await expect(backing.stat("/workspace/.claude/skills/demo")).rejects.toMatchObject({ code: "ENOENT" });
  expect(new TextDecoder().decode(await backing.readFile("/workspace/.poe-code/skills/demo/SKILL.md"))).toBe("source");
});
