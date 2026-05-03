import type {
  ConfigDocument,
  InferConfig,
  MemoryConfig,
  ResolvedConfig,
  ScopedConfig
} from "./types.js";
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
  },
  plugins: {
    type: "json",
    default: null as Array<{ name: string; options?: unknown }> | null,
    parse: (value: unknown) => value as Array<{ name: string; options?: unknown }> | null,
    doc: "Configured poe-agent plugins"
  }
});

type ignoredInferConfigShape = AssertAssignable<
  InferConfig<typeof ignoredScope.schema>,
  {
    apiKey: string;
    maxRetries: number;
    enabled: boolean;
    plugins: Array<{ name: string; options?: unknown }> | null;
  }
>;

declare const scopedConfig: ScopedConfig<typeof ignoredScope.schema>;

const ignoredApiKeyPromise = scopedConfig.get("apiKey");
const ignoredRetriesPromise = scopedConfig.get("maxRetries");
const ignoredEnabledPromise = scopedConfig.get("enabled");
const ignoredPluginsPromise = scopedConfig.get("plugins");

type ignoredGetApiKey = AssertAssignable<Promise<string>, typeof ignoredApiKeyPromise>;
type ignoredGetRetries = AssertAssignable<Promise<number>, typeof ignoredRetriesPromise>;
type ignoredGetEnabled = AssertAssignable<Promise<boolean>, typeof ignoredEnabledPromise>;
type ignoredGetPlugins = AssertAssignable<
  Promise<Array<{ name: string; options?: unknown }> | null>,
  typeof ignoredPluginsPromise
>;

type ignoredMemoryConfigShape = AssertAssignable<
  MemoryConfig,
  {
    root?: string;
    ingestAgent?: string;
    ingestTimeoutMs?: number;
    maxPageBytes?: number;
    confidence?: {
      rejectUntagged?: boolean;
      minInferredConfidence?: number;
    };
    cache?: {
      enabled?: boolean;
      maxAgeMs?: number;
    };
    mcp?: {
      allowWrites?: boolean;
    };
    query?: {
      defaultBudgetTokens?: number;
    };
  }
>;

type ignoredConfigDocumentMemoryEntry = AssertAssignable<
  ConfigDocument,
  {
    memory?: MemoryConfig;
    models?: Record<string, unknown>;
  }
>;

type ignoredResolvedConfigRuntime = AssertAssignable<
  ResolvedConfig,
  {
    runtime: {
      type: "host" | "docker" | "e2b";
      build_args: Record<string, string>;
      mounts: Array<{ source: string; target: string; readonly?: boolean }>;
      link?: string;
    };
  }
>;
