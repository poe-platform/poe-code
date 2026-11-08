import { describe, it, expect } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import {
  agent,
  AuthenticationError,
  isUserError,
  UserError,
  createLogWriter,
  createRunQueue,
  createStateStore,
  createSupervisor,
  codeReviewGroup,
  createCodeReviewAgentMcpConfig,
  createCodeReviewSession,
  createCodeReviewState,
  commitCodeReviewDrafts,
  discoverCodeReviewProfiles,
  ghGroup,
  getPoeApiKey,
  getPoeAuthIdentity,
  ingestCodeReviewProfile,
  installSkill,
  installCodeReviewAssets,
  isCliInvocation,
  loadCodeReviewProfile,
  planDocumentSchema,
  planDocumentSchemaId,
  openaiResponsesPlugin,
  previewCodeReviewSpawnPrompt,
  readCodeReviewDraft,
  resolvePromptDocument,
  runExperiment,
  runCodeReview,
  runCodeReviewAgentMcp,
  runRalph,
  runSuperintendentSequence,
  systemPromptPlugin,
  waitForReady,
  type AgentPlugin,
  type AutomationDefinition,
  type ProcessSpec,
  type SupervisorOptions,
  type SuperintendentSequenceOptions,
  type SuperintendentSequenceResult
} from "./index.js";

describe("entrypoint module", () => {
  it("re-exports the composable agent runtime", () => {
    const plugin: AgentPlugin = { name: "consumer-plugin" };

    expect(typeof agent).toBe("function");
    expect(typeof openaiResponsesPlugin).toBe("function");
    expect(typeof systemPromptPlugin).toBe("function");
    expect(plugin.name).toBe("consumer-plugin");
  });

  it("re-exports getPoeApiKey", async () => {
    const previous = process.env.POE_API_KEY;
    process.env.POE_API_KEY = "sdk-test-key";

    try {
      await expect(getPoeApiKey()).resolves.toBe("sdk-test-key");
    } finally {
      if (typeof previous === "string") {
        process.env.POE_API_KEY = previous;
      } else {
        delete process.env.POE_API_KEY;
      }
    }
  });

  it("re-exports getPoeAuthIdentity", async () => {
    const httpClient = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: 1,
        handle: "sdk",
        name: "SDK User",
        profile_picture: ""
      })
    });

    await expect(getPoeAuthIdentity({ apiKey: "sdk-key", httpClient })).resolves.toMatchObject({
      handle: "sdk",
      name: "SDK User"
    });
  });

  it("re-exports typed errors so consumers branch without string matching", () => {
    const authError = new AuthenticationError("No API key found.");

    expect(authError).toBeInstanceOf(Error);
    expect(authError.name).toBe("AuthenticationError");
    expect(authError.isUserError).toBe(true);

    expect(typeof isUserError).toBe("function");
    expect(isUserError(new UserError("bad input"))).toBe(true);
    expect(isUserError(new Error("boom"))).toBe(false);
  });

  it("detects direct invocation path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/index.js"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(true);
  });

  it("detects invocation through symlinked path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/usr/bin/poe-code"];
    const resolver = (value: string) =>
      value === "/usr/bin/poe-code" ? "/app/dist/index.js" : value;
    expect(isCliInvocation(argv, moduleUrl, resolver)).toBe(true);
  });

  it("re-exports runRalph", () => {
    expect(typeof runRalph).toBe("function");
  });

  it("re-exports code-review SDK and CLI wiring", () => {
    expect(codeReviewGroup.name).toBe("code-review");
    expect(typeof createCodeReviewAgentMcpConfig).toBe("function");
    expect(typeof createCodeReviewSession).toBe("function");
    expect(typeof createCodeReviewState).toBe("function");
    expect(typeof discoverCodeReviewProfiles).toBe("function");
    expect(typeof installCodeReviewAssets).toBe("function");
    expect(typeof loadCodeReviewProfile).toBe("function");
    expect(typeof previewCodeReviewSpawnPrompt).toBe("function");
    expect(typeof ingestCodeReviewProfile).toBe("function");
    expect(typeof runCodeReview).toBe("function");
    expect(typeof readCodeReviewDraft).toBe("function");
    expect(typeof commitCodeReviewDrafts).toBe("function");
    expect(typeof runCodeReviewAgentMcp).toBe("function");
  });

  it("re-exports runExperiment", () => {
    expect(typeof runExperiment).toBe("function");
  });

  it("runs a live Superintendent queue through the public SDK", async () => {
    const doc = [
      "---", "kind: superintendent", "version: 1",
      "builder:", "  agent: codex:chosen-model", "  mode: edit", "  prompt: Build the feature",
      "superintendent:", "  agent: claude-code", "  prompt: Review",
      "owner:", "  agent: claude-code", "  prompt: Approve",
      "status:", "  state: in_progress", "  round: 0", "  review_turn: 0",
      "---", "## Task Board", "- [ ] Build the feature"
    ].join("\n");
    const queue = createRunQueue({ plans: ["first.md"], cwd: "/repo" });
    const calls: string[] = [];
    const options: SuperintendentSequenceOptions = {
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFsFromVolume(Volume.fromJSON({
        "/repo/first.md": doc,
        "/repo/second.md": doc
      })).promises as unknown as SuperintendentSequenceOptions["fs"],
      queue,
      runPlan: async ({ docPath }) => {
        calls.push(docPath);
        if (calls.length === 1) {
          queue.enqueueMessage("Review API");
          queue.enqueueMessage("Verify tests");
          queue.enqueuePlan("second.md");
        }
        return {
          state: "completed", round: 1, reviewTurn: 0,
          maxRounds: 100, maxReviewTurns: 5, stopReason: "completed"
        };
      },
      runAgent: async ({ agent, prompt, cwd, mode }) => {
        expect({ agent, cwd, mode }).toEqual({ agent: "codex:chosen-model", cwd: "/repo", mode: "edit" });
        calls.push(prompt.split("\n\n").at(-1)!);
        return { stdout: "Verified", stderr: "", exitCode: 0 };
      }
    };

    const result: SuperintendentSequenceResult = await runSuperintendentSequence(options);

    expect(calls).toEqual(["/repo/first.md", "Review API", "Verify tests", "/repo/second.md"]);
    expect(result.status).toBe("completed");
    expect(result.plans).toHaveLength(2);
    expect(result.messages).toHaveLength(2);
  });

  it("re-exports the generic skill installer", () => {
    expect(typeof installSkill).toBe("function");
  });

  it("re-exports the prompt document resolver", () => {
    expect(typeof resolvePromptDocument).toBe("function");
  });

  it("re-exports process launcher SDK helpers", () => {
    const spec: ProcessSpec = {
      id: "service",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure",
      readyCheck: {
        kind: "log-pattern",
        pattern: "ready"
      }
    };
    const options: SupervisorOptions = {
      spec,
      stateDir: "/tmp/poe-code",
      signal: new AbortController().signal,
      onLog() {},
      onStatusChange() {}
    };

    expect(typeof createSupervisor).toBe("function");
    expect(typeof createStateStore).toBe("function");
    expect(typeof createLogWriter).toBe("function");
    expect(typeof waitForReady).toBe("function");
    expect(options.spec.readyCheck).toEqual(spec.readyCheck);
  });

  it("re-exports the generic plan document schema", () => {
    expect(planDocumentSchemaId).toBe(
      "https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json"
    );
    expect(planDocumentSchema).toMatchObject({
      $id: planDocumentSchemaId,
      type: "object",
      properties: {
        kind: { const: "plan" }
      },
      required: ["kind"],
      additionalProperties: true
    });
  });

  it("re-exports github workflows SDK symbols", () => {
    const automation: AutomationDefinition = {
      name: "github-issue-opened",
      prompt: "Handle issue"
    };

    expect(ghGroup.name).toBe("github-workflows");
    expect(automation.name).toBe("github-issue-opened");
  });

  it("returns false when invoked via CJS wrapper (bin.cjs)", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/bin.cjs"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(false);
  });
});
