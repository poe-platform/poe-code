import { createMockFs } from "@poe-code/config-mutations/testing";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import {
  loadProviderShapeBaseUrls,
  resolveServicesConfigPath,
  saveProviderShapeBaseUrls
} from "./index.js";

const homeDir = "/home/test";
const servicesConfigPath = resolveServicesConfigPath(homeDir);

describe("provider config", () => {
  it("treats a missing providers section as an empty map", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "poe"
      })
    ).resolves.toEqual({});
  });

  it("saves shape base URLs under the provider entry", async () => {
    const fs = createMockFs(undefined, homeDir);

    await saveProviderShapeBaseUrls({
      fs,
      filePath: servicesConfigPath,
      providerId: "poe",
      shapeBaseUrls: {
        "anthropic-messages": "https://example/anth"
      }
    });

    expect(fs.getContent("~/.config/poe-code/services.json")).toMatchInlineSnapshot(`
      "{
        "providers": {
          "poe": {
            "shapeBaseUrls": {
              "anthropic-messages": "https://example/anth"
            }
          }
        }
      }
      "
    `);
  });

  it("merges new shape base URLs with existing provider config", async () => {
    const fs = createMockFs(
      {
        "~/.config/poe-code/services.json": `${JSON.stringify(
          {
            providers: {
              poe: {
                shapeBaseUrls: {
                  "anthropic-messages": "https://example/anth"
                }
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await saveProviderShapeBaseUrls({
      fs,
      filePath: servicesConfigPath,
      providerId: "poe",
      shapeBaseUrls: {
        "openai-responses": "https://example/openai"
      }
    });

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "poe"
      })
    ).resolves.toEqual({
      "anthropic-messages": "https://example/anth",
      "openai-responses": "https://example/openai"
    });
  });

  it("rejects provider metadata reads through a symlinked services directory", async () => {
    const volume = new Volume();
    volume.mkdirSync(`${homeDir}/.config`, { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", `${homeDir}/.config/poe-code`);
    volume.writeFileSync(
      "/outside/services.json",
      JSON.stringify({ providers: { cloudflare: { shapeBaseUrls: { "openai-responses": "https://outside" } } } })
    );
    const fs = createFsFromVolume(volume).promises as any;

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "cloudflare"
      })
    ).rejects.toThrow("symbolic link");
  });
});
