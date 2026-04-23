import { S } from "agent-kit-schema";
import { defineCommand, defineGroup } from "./index.js";
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
          ],
        }),
      ],
    }),
  ],
});

const ignoredOptions = {
  casing: "camel",
  services: {
    logger: console,
  },
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
