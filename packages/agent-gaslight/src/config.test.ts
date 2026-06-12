import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { loadGaslightConfig } from "./config.js";

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

  it("reports both searched paths when config is missing", async () => {
    const fs = createFsFromVolume(new Volume()).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).rejects.toThrow(
      /\/repo\/\.poe-code\/gaslight\.yaml[\s\S]*\/home\/me\/\.poe-code\/gaslight\.yaml/
    );
  });

  it.each([
    "followups:\n  - Test it\n",
    "prompt: Implement\nfollowups: []\n",
    "prompt: Implement\nfollowups:\n  - 42\n"
  ])("names invalid config files", async (content) => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/.poe-code/gaslight.yaml": content })
    ).promises;

    await expect(loadGaslightConfig("/repo", "/home/me", fs)).rejects.toThrow(
      "/repo/.poe-code/gaslight.yaml"
    );
  });
});
