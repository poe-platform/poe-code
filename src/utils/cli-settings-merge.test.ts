import { describe, it, expect } from "bun:test";
import {
  extractSettingsFromArgs,
  mergeCliSettings,
  buildArgsWithMergedSettings
} from "./cli-settings-merge.js";

describe("cli-settings-merge", () => {
  describe("extractSettingsFromArgs", () => {
    it("returns null settings when --settings not present", () => {
      const args = ["-p", "query", "--model", "opus"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toBeNull();
      expect(result.argsWithoutSettings).toEqual(args);
    });

    it("extracts JSON settings from args", () => {
      const args = ["-p", "--settings", '{"model":"opus"}', "query"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({ model: "opus" });
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("handles --settings at end of args", () => {
      const args = ["-p", "query", "--settings", '{"verbose":true}'];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({ verbose: true });
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("handles --settings at start of args", () => {
      const args = ["--settings", '{"model":"sonnet"}', "-p", "query"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({ model: "sonnet" });
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("returns null for file path settings (non-JSON)", () => {
      const args = ["-p", "--settings", "./settings.json", "query"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toBeNull();
      expect(result.settingsFilePath).toBe("./settings.json");
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("handles --settings without value", () => {
      const args = ["-p", "query", "--settings"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toBeNull();
      expect(result.argsWithoutSettings).toEqual(args);
    });

    it("extracts nested settings objects", () => {
      const args = ["--settings", '{"env":{"MY_VAR":"foo"},"model":"opus"}'];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({
        env: { MY_VAR: "foo" },
        model: "opus"
      });
    });
  });

  describe("mergeCliSettings", () => {
    it("returns required settings when user settings is null", () => {
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(null, required);

      expect(result).toEqual(required);
    });

    it("preserves user settings not in required", () => {
      const user = { model: "opus", verbose: true };
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        model: "opus",
        verbose: true,
        apiKeyHelper: "echo $KEY"
      });
    });

    it("required settings override user settings", () => {
      const user = { apiKeyHelper: "my-script.sh", model: "opus" };
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        model: "opus",
        apiKeyHelper: "echo $KEY"
      });
    });

    it("deep merges env objects", () => {
      const user = { env: { MY_VAR: "foo", OTHER: "bar" } };
      const required = { env: { ANTHROPIC_BASE_URL: "https://api.poe.com" } };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        env: {
          MY_VAR: "foo",
          OTHER: "bar",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        }
      });
    });

    it("required env values override user env values", () => {
      const user = { env: { ANTHROPIC_BASE_URL: "https://custom.com" } };
      const required = { env: { ANTHROPIC_BASE_URL: "https://api.poe.com" } };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
      });
    });

    it("handles user with env and required without env", () => {
      const user = { env: { MY_VAR: "foo" } };
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        env: { MY_VAR: "foo" },
        apiKeyHelper: "echo $KEY"
      });
    });

    it("handles user without env and required with env", () => {
      const user = { model: "opus" };
      const required = { env: { ANTHROPIC_BASE_URL: "https://api.poe.com" } };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        model: "opus",
        env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
      });
    });
  });

  describe("buildArgsWithMergedSettings", () => {
    it("adds --settings when not present in args", () => {
      const args = ["-p", "query"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      expect(result).toEqual([
        "-p",
        "query",
        "--settings",
        '{"apiKeyHelper":"echo $KEY"}'
      ]);
    });

    it("merges with existing --settings JSON", () => {
      const args = ["-p", "--settings", '{"model":"opus"}', "query"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      expect(result).toEqual([
        "-p",
        "query",
        "--settings",
        '{"model":"opus","apiKeyHelper":"echo $KEY"}'
      ]);
    });

    it("replaces file path --settings with merged JSON", () => {
      const args = ["-p", "--settings", "./settings.json", "query"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      // File path is removed, only our settings applied
      // (file reading would need to be handled separately)
      expect(result).toEqual([
        "-p",
        "query",
        "--settings",
        '{"apiKeyHelper":"echo $KEY"}'
      ]);
    });

    it("preserves other args order", () => {
      const args = ["--model", "opus", "-p", "query", "--verbose"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      expect(result).toEqual([
        "--model",
        "opus",
        "-p",
        "query",
        "--verbose",
        "--settings",
        '{"apiKeyHelper":"echo $KEY"}'
      ]);
    });

    it("handles complex merge with env", () => {
      const args = [
        "--settings",
        '{"model":"opus","env":{"MY_VAR":"foo"}}',
        "-p",
        "query"
      ];
      const required = {
        apiKeyHelper: "echo $POE_API_KEY",
        env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
      };
      const result = buildArgsWithMergedSettings(args, required);

      const parsed = JSON.parse(result[result.indexOf("--settings") + 1]);
      expect(parsed).toEqual({
        model: "opus",
        env: {
          MY_VAR: "foo",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        },
        apiKeyHelper: "echo $POE_API_KEY"
      });
    });
  });
});
