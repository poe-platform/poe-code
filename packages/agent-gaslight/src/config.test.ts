import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { loadGaslightConfig, parseGaslightConfig } from "./config.js";

describe("loadGaslightConfig", () => {
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

  it("loads optional archive behavior from config", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml": "prompt: Implement\narchive: true\nfollowups:\n  - Test it\n"
      })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).resolves.toMatchObject({
      prompt: "Implement",
      followups: ["Test it"],
      archive: true
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
    "prompt: Implement\narchive: 1\nfollowups:\n  - Test it\n"
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
