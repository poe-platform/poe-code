import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import type { HumanInLoopPending, HumanInLoopRuntime } from "./index.js";
import { createSDK } from "./sdk.js";
import type { CreateSDKOptions } from "./sdk.js";

const ignoredRoot = defineGroup({
  name: "root",
  children: [
    defineGroup({
      name: "poe-code",
      children: [
        defineGroup({
          name: "generate",
          children: [
            defineCommand({
              name: "text",
              scope: ["sdk"],
              params: S.Object({
                prompt_text: S.String(),
                max_tokens: S.Optional(S.Number()),
              }),
              handler: async ({ params }) => ({
                model: "demo",
                content: params.prompt_text,
                maxTokens: params.max_tokens ?? 0,
              }),
            }),
            defineCommand({
              name: "HTTPServer",
              scope: ["sdk"],
              params: S.Object({
                APIKey: S.String(),
              }),
              handler: async ({ params }) => ({
                apiKey: params.APIKey,
              }),
            }),
            defineCommand({
              name: "cli-only",
              scope: ["cli"],
              params: S.Object({}),
              handler: async () => "hidden",
            }),
            defineCommand({
              name: "queued",
              scope: ["sdk"],
              params: S.Object({
                prompt_text: S.String(),
              }),
              humanInLoop: {
                mode: "async",
                message: () => "queue it",
              },
              handler: async ({ params }) => ({
                content: params.prompt_text,
              }),
            }),
          ],
        }),
        defineGroup({
          name: "review",
          scope: ["sdk"],
          humanInLoop: {
            mode: "async",
            message: () => "needs review",
          },
          children: [
            defineCommand({
              name: "submit",
              params: S.Object({
                target_name: S.String(),
              }),
              handler: async ({ params }) => ({
                target: params.target_name,
              }),
            }),
            defineCommand({
              name: "skip",
              params: S.Object({
                target_name: S.String(),
              }),
              humanInLoop: null,
              handler: async ({ params }) => ({
                target: params.target_name,
              }),
            }),
          ],
        }),
      ],
    }),
  ],
});

const ignoredOptions = {
  approvals: false,
  casing: "camel",
  fetch: globalThis.fetch,
  services: {
    logger: console,
  },
  humanInLoop: {
    invoke: async (node, ctx) => node.handler(ctx),
    mergeApprovalsGroup: (root) => root,
  } satisfies HumanInLoopRuntime,
} satisfies CreateSDKOptions<{ logger: Console }>;

const ignoredSdk = createSDK(ignoredRoot, ignoredOptions);
const ignoredResult = ignoredSdk.poeCode.generate.text({
  promptText: "hello",
  maxTokens: 128,
});

void ignoredResult.then((value: Awaited<typeof ignoredResult>) => {
  void value.model;
  void value.content;
  void value.maxTokens;
});

const ignoredHttpServerResult = ignoredSdk.poeCode.generate.httpServer({
  apiKey: "secret",
});

void ignoredHttpServerResult.then((value: Awaited<typeof ignoredHttpServerResult>) => {
  void value.apiKey;
});

const ignoredQueuedResult = ignoredSdk.poeCode.generate.queued({
  promptText: "hello",
});

void ignoredQueuedResult.then((value: Awaited<typeof ignoredQueuedResult>) => {
  const pending: HumanInLoopPending = value;
  void pending.approvalId;
  void pending.message;
});

const ignoredInheritedAsyncResult = ignoredSdk.poeCode.review.submit({
  targetName: "prod",
});

void ignoredInheritedAsyncResult.then((value: Awaited<typeof ignoredInheritedAsyncResult>) => {
  void value.status;
  void value.enqueuedAt;
});

const ignoredOptedOutResult = ignoredSdk.poeCode.review.skip({
  targetName: "prod",
});

void ignoredOptedOutResult.then((value: Awaited<typeof ignoredOptedOutResult>) => {
  void value.target;
});

// @ts-expect-error cli-only commands are not exposed in the SDK surface
void ignoredSdk.poeCode.generate.cliOnly;

// @ts-expect-error wrong parameter name
ignoredSdk.poeCode.generate.text({ prompt_text: "hello" });

// @ts-expect-error wrong parameter type
ignoredSdk.poeCode.generate.text({ promptText: 123 });

// @ts-expect-error acronym command names should still camel-case cleanly
void ignoredSdk.poeCode.generate.hTTPServer;

// @ts-expect-error acronym parameter names should camel-case cleanly
ignoredSdk.poeCode.generate.httpServer({ aPIKey: "secret" });

void ignoredQueuedResult.then((value: Awaited<typeof ignoredQueuedResult>) => {
  // @ts-expect-error async human-in-loop commands return the pending marker, not the handler result
  void value.content;
});

void ignoredInheritedAsyncResult.then((value: Awaited<typeof ignoredInheritedAsyncResult>) => {
  // @ts-expect-error inherited async human-in-loop mode also returns the pending marker
  void value.target;
});

void ignoredOptedOutResult.then((value: Awaited<typeof ignoredOptedOutResult>) => {
  // @ts-expect-error opting out of inherited human-in-loop keeps the handler result type
  void value.approvalId;
});
