import path from "node:path";
import type { E2bRuntime } from "@poe-code/poe-code-config";
import type { ExecutionEnvFactory, OpenSpec, OpenedEnv } from "@poe-code/agent-harness-tools";
import { createSandbox, connectSandbox } from "./sdk.js";
import { buildOrResolveTemplate } from "./template-build.js";
import { createOpenedE2bEnv } from "./opened-env.js";
import { resolveE2bApiKey } from "./auth-scope.js";

export const e2bExecutionEnvFactory: ExecutionEnvFactory = {
  type: "e2b",
  supportsDetach: true,
  async open(spec): Promise<OpenedEnv> {
    const runtime = parseE2bRuntime(spec.runtime);
    const apiKey = await resolveE2bApiKey({ cwd: spec.cwd });
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
  async attach(envId, context): Promise<OpenedEnv> {
    const cwd = context?.cwd ?? process.cwd();
    const apiKey = await resolveE2bApiKey({ cwd });
    const sandbox = await connectSandbox(envId, apiKey);
    return createOpenedE2bEnv({
      sandbox,
      spec: {
        cwd: context?.cwd ?? "/workspace",
        runtime: {
          type: "e2b",
          build_args: {},
          mounts: [],
          preserve_after_exit_hours: 24
        },
        env: {},
        uploadIgnoreFiles: [],
        jobLabel: { tool: context?.tool ?? "e2b", argv: context?.argv ?? [] },
        ...(context?.jobId ? { detachedJobId: context.jobId } : {})
      } as OpenSpec & { detachedJobId?: string },
      runtime: {
        type: "e2b",
        build_args: {},
        mounts: [],
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
