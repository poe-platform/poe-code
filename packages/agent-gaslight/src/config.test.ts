import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { GASLIGHT_CONFIG_EXAMPLE, loadGaslightConfig, parseGaslightConfig } from "./config.js";

describe("loadGaslightConfig", () => {
  it("enables successful-plan archiving in the generated config", () => {
    expect(parseGaslightConfig(GASLIGHT_CONFIG_EXAMPLE, "generated")).toMatchObject({
      archive: true
    });
  });

  it("prefers project config over global config", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml": "prompt: Build\nfollowups:\n  - Check it\n",
        "/home/me/.poe-code/gaslight.yaml": "prompt: Global\nfollowups:\n  - Ignore me\n"
      })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).resolves.toEqual({
      prompt: "Build",
      followups: ["Check it"],
      path: "/repo/.poe-code/gaslight.yaml"
    });
  });

  it("loads global config when project config is missing", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/gaslight.yaml": "prompt: Implement\nfollowups:\n  - Test it\n"
      })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).resolves.toMatchObject({
      prompt: "Implement",
      followups: ["Test it"]
    });
  });

  it("loads optional auto-archive behavior from config", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml":
          "prompt: Implement\nauto-archive: true\nfollowups:\n  - Test it\n"
      })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).resolves.toMatchObject({
      prompt: "Implement",
      followups: ["Test it"],
      archive: true
    });
  });

  it("loads optional setup and teardown prompts from config", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml":
          "setup: Prepare the workspace\nprompt: Implement\nfollowups:\n  - Test it\nteardown: Clean up the workspace\n"
      })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).resolves.toMatchObject({
      setup: "Prepare the workspace",
      prompt: "Implement",
      followups: ["Test it"],
      teardown: "Clean up the workspace"
    });
  });

  it("loads optional agent and prompt variables from config", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml": [
          "agent: codex",
          "vars:",
          "  quality: production-ready",
          "prompt: Implement a {{quality}} solution",
          "followups:",
          "  - Verify it is {{quality}}",
          ""
        ].join("\n")
      })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).resolves.toMatchObject({
      agent: "codex",
      vars: { quality: "production-ready" },
      prompt: "Implement a {{quality}} solution",
      followups: ["Verify it is {{quality}}"]
    });
  });

  it("loads an explicit config path instead of searching defaults", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/codex-gaslight.yaml": "prompt: Review\nfollowups:\n  - Check output\n",
        "/repo/.poe-code/gaslight.yaml": "prompt: Ignore\nfollowups:\n  - Ignore me\n"
      })
    ).promises;

    await expect(
      loadGaslightConfig("/repo", "/home/me", fs, ".poe-code/codex-gaslight.yaml")
    ).resolves.toEqual({
      prompt: "Review",
      followups: ["Check output"],
      path: "/repo/.poe-code/codex-gaslight.yaml"
    });
  });

  it("names the --config path as a user error when it does not exist", async () => {
    const fs = createFsFromVolume(new Volume()).promises;

    const error = await loadGaslightConfig("/repo", "/home/me", fs, "/tmp/no-gaslight.yaml").catch(
      (thrown: unknown) => thrown as Error
    );

    expect(error.name).toBe("UserError");
    expect(error.message).toContain("/tmp/no-gaslight.yaml");
    expect(error.message).not.toContain("ENOENT");
    expect(error.message).toContain("poe-code gaslight install");
  });

  it("resolves a relative --config path before naming it as missing", async () => {
    const fs = createFsFromVolume(new Volume()).promises;

    await expect(
      loadGaslightConfig("/repo", "/home/me", fs, "custom/gaslight.yaml")
    ).rejects.toThrow("/repo/custom/gaslight.yaml");
  });

  it("reports both searched paths when config is missing", async () => {
    const fs = createFsFromVolume(new Volume()).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).rejects.toThrow(
      /\/repo\/\.poe-code\/gaslight\.yaml[\s\S]*\/home\/me\/\.poe-code\/gaslight\.yaml/
    );
  });

  it.each([
    "followups:\n  - Test it\n",
    "prompt: Implement\nfollowups: []\n",
    "prompt: Implement\nfollowups:\n  - 42\n",
    "prompt: Implement\nauto-archive: 1\nfollowups:\n  - Test it\n",
    "setup: 42\nprompt: Implement\nfollowups:\n  - Test it\n",
    "prompt: Implement\nfollowups:\n  - Test it\nteardown: '   '\n",
    "agent: '   '\nprompt: Implement\nfollowups:\n  - Test it\n",
    "vars:\n  count: 2\nprompt: Implement\nfollowups:\n  - Test it\n"
  ])("names invalid config files", async (content) => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/.poe-code/gaslight.yaml": content })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).rejects.toThrow(
      "/repo/.poe-code/gaslight.yaml"
    );
  });

  it("rejects extra keys for generated configs", () => {
    expect(() =>
      parseGaslightConfig("prompt: Implement\nfollowups:\n  - Test\nextra: no\n", "generated", {
        rejectExtraKeys: true
      })
    ).toThrow("unexpected key");
  });
});
