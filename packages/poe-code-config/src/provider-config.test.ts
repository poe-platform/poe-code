import { createMockFs } from "@poe-code/config-mutations/testing";
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
});
