import type { InferConfig, ScopedConfig } from "./types.js";
import { defineScope } from "./schema.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredScope = defineScope("core", {
  apiKey: {
    type: "string",
    default: "",
    doc: "Poe API key"
  },
  maxRetries: {
    type: "number",
    default: 3,
    doc: "Retry count"
  },
  enabled: {
    type: "boolean",
    default: false,
    doc: "Whether config is enabled"
  }
});

type ignoredInferConfigShape = AssertAssignable<
  InferConfig<typeof ignoredScope.schema>,
  {
    apiKey: string;
    maxRetries: number;
    enabled: boolean;
  }
>;

declare const scopedConfig: ScopedConfig<typeof ignoredScope.schema>;

const ignoredApiKeyPromise = scopedConfig.get("apiKey");
const ignoredRetriesPromise = scopedConfig.get("maxRetries");
const ignoredEnabledPromise = scopedConfig.get("enabled");

type ignoredGetApiKey = AssertAssignable<Promise<string>, typeof ignoredApiKeyPromise>;
type ignoredGetRetries = AssertAssignable<Promise<number>, typeof ignoredRetriesPromise>;
type ignoredGetEnabled = AssertAssignable<Promise<boolean>, typeof ignoredEnabledPromise>;
