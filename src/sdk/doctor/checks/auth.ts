import type { DoctorCheck, DoctorContext, CheckResult } from "../types.js";

function apiKeyPresentCheck(): DoctorCheck {
  return {
    id: "auth.api-key-present",
    category: "auth",
    description: "API key available",
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const key = await ctx.readApiKey();
      if (key) {
        return { status: "pass", message: "API key found" };
      }
      return {
        status: "fail",
        message: "No API key found",
        fix: 'Run "poe-code login" to store your Poe API key.'
      };
    }
  };
}

function apiKeyValidCheck(): DoctorCheck {
  return {
    id: "auth.api-key-valid",
    category: "auth",
    description: "API key works",
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const prev = ctx.previousResults.get("auth.api-key-present");
      if (prev && prev.status === "fail") {
        return { status: "skip", message: "Skipped (no API key)" };
      }

      if (ctx.dryRun) {
        return { status: "skip", message: "Skipped (dry run)" };
      }

      const key = await ctx.readApiKey();
      if (!key) {
        return { status: "skip", message: "Skipped (no API key)" };
      }

      try {
        const response = await ctx.httpClient(
          `${ctx.env.poeBaseUrl}/usage/current_balance`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${key}` }
          }
        );

        if (response.ok) {
          return { status: "pass", message: "API key is valid" };
        }

        return {
          status: "fail",
          message: `API key rejected (HTTP ${response.status})`,
          fix: 'Run "poe-code login" to update your API key.'
        };
      } catch (error) {
        return {
          status: "fail",
          message: `API request failed: ${(error as Error).message}`,
          fix: "Check your internet connection."
        };
      }
    }
  };
}

export function authChecks(): DoctorCheck[] {
  return [apiKeyPresentCheck(), apiKeyValidCheck()];
}
