import path from "node:path";
import type { E2bRuntime } from "@poe-code/poe-code-config";
import type { ExecutionEnvFactory, OpenSpec, OpenedEnv } from "@poe-code/agent-harness-tools";
import { createSandbox, connectSandbox } from "./sdk.js";
import { buildOrResolveTemplate } from "./template-build.js";
import { createOpenedE2bEnv } from "./opened-env.js";

export const e2bExecutionEnvFactory: ExecutionEnvFactory = {
  type: "e2b",
  supportsDetach: true,
  async open(spec): Promise<OpenedEnv> {
    const runtime = parseE2bRuntime(spec.runtime);
    const apiKey = resolveApiKey(spec, runtime);
    const templateId =
      runtime.template_id ??
      (
        await buildOrResolveTemplate({
          runtime,
          dockerfilePath: path.resolve(
            spec.cwd,
            runtime.dockerfile ?? path.join(".poe-code", "Dockerfile")
          ),
          buildContext: path.resolve(spec.cwd, runtime.build_context ?? "."),
          state: spec.state,
          apiKey
        })
      ).templateId;
    const sandbox = await createSandbox({
      apiKey,
      templateId,
      env: spec.env,
      timeoutMinutes: runtime.timeout_minutes
    });

    return createOpenedE2bEnv({ sandbox, spec, runtime });
  },
  async attach(envId): Promise<OpenedEnv> {
    const apiKey = process.env.E2B_API_KEY?.trim();
    const sandbox = await connectSandbox(envId, apiKey && apiKey.length > 0 ? apiKey : undefined);
    return createOpenedE2bEnv({
      sandbox,
      spec: {
        cwd: "/workspace",
        runtime: {
          type: "e2b",
          build_args: {},
          mounts: [],
          api_key_env: "E2B_API_KEY",
          preserve_after_exit_hours: 24
        },
        env: {},
        uploadIgnoreFiles: [],
        jobLabel: { tool: "e2b", argv: [] }
      },
      runtime: {
        type: "e2b",
        build_args: {},
        mounts: [],
        api_key_env: "E2B_API_KEY",
        preserve_after_exit_hours: 24
      }
    });
  }
};

function parseE2bRuntime(runtime: unknown): E2bRuntime {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("e2b runtime must be an object");
  }
  const record = runtime as Record<string, unknown>;
  if (record.type !== "e2b") {
    throw new Error('e2b runtime type must be "e2b"');
  }
  return record as unknown as E2bRuntime;
}

function resolveApiKey(spec: OpenSpec, runtime: E2bRuntime): string {
  const authKey = readAuthProviderKey(spec);
  if (authKey !== null) {
    return authKey;
  }

  const envName = runtime.api_key_env ?? "E2B_API_KEY";
  const apiKey = process.env[envName]?.trim();
  if (apiKey && apiKey.length > 0) {
    return apiKey;
  }

  throw new Error(`No E2B API key found. Set ${envName} or configure auth.providers.e2b.`);
}

function readAuthProviderKey(spec: OpenSpec): string | null {
  const auth = (spec as OpenSpec & { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    return null;
  }
  const providers = (auth as { providers?: unknown }).providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return null;
  }
  const e2b = (providers as { e2b?: unknown }).e2b;
  if (typeof e2b === "string") {
    const trimmed = e2b.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!e2b || typeof e2b !== "object" || Array.isArray(e2b)) {
    return null;
  }
  const apiKey = (e2b as { api_key?: unknown }).api_key;
  if (typeof apiKey !== "string") {
    return null;
  }
  const trimmed = apiKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}
