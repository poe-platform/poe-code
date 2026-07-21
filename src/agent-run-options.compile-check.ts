import type { AgentRunOptions } from "./agent.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredAgentRunOptionsAllowsEnvironmentOverrides = AssertAssignable<
  AgentRunOptions,
  {
    env: {
      POE_API_KEY: string;
      OPTIONAL_SETTING: undefined;
    };
  }
>;
