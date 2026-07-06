import { S } from "toolcraft-schema";
import {
  NotFoundError,
  UserError,
  defineCommand,
  defineGroup,
  type CommandConfig,
  type CommandNode,
  type Group
} from "../index.js";
import type { ObjectSchema } from "toolcraft-schema";
import type { SecretDeclarations } from "../index.js";

export interface FixtureService {
  execute(value: string): Promise<string>;
}

export interface FixtureServices {
  fakeService: FixtureService;
}

const emptyParams = S.Object({});

function defineFixtureCommand<
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown
>(config: CommandConfig<FixtureServices, TParamsSchema, TSecrets, TResult>) {
  return defineCommand(config);
}

export function createHarnessFixtureGroup(): Group<FixtureServices> {
  const params = defineFixtureCommand({
    name: "params",
    params: S.Object({
      name: S.String(),
      count: S.Optional(S.Number({ default: 2 }))
    }),
    handler: async ({ params: values }) => values
  });

  const secrets = defineFixtureCommand({
    name: "secrets",
    params: emptyParams,
    secrets: {
      required: { env: "FIXTURE_REQUIRED_SECRET" },
      optional: { env: "FIXTURE_OPTIONAL_SECRET", optional: true }
    },
    handler: async ({ secrets: values }) => values
  });

  const otherSecrets = defineFixtureCommand({
    name: "other-secrets",
    params: emptyParams,
    secrets: {
      required: { env: "FIXTURE_OTHER_REQUIRED_SECRET" }
    },
    handler: async ({ secrets: values }) => values
  });

  const auth = defineFixtureCommand({
    name: "auth",
    params: emptyParams,
    requires: { auth: true },
    handler: async () => "authenticated"
  });

  const check = defineFixtureCommand({
    name: "check",
    params: emptyParams,
    requires: {
      check: async () => ({ ok: false, message: "Fixture check failed." })
    },
    handler: async () => "checked"
  });

  const confirm = defineFixtureCommand({
    name: "confirm",
    params: emptyParams,
    confirm: true,
    handler: async () => "confirmed"
  });

  const humanInLoop = defineFixtureCommand({
    name: "human-in-loop",
    params: S.Object({ target: S.String() }),
    humanInLoop: {
      mode: "sync",
      message: ({ params: values }) => `Deploy ${values.target}?`
    },
    handler: async () => "deployed"
  });

  const humanInLoopPath = defineFixtureCommand({
    name: "human-in-loop-path",
    params: emptyParams,
    humanInLoop: {
      mode: "sync",
      message: ({ commandPath }) => `Approve ${commandPath}?`
    },
    handler: async () => "approved"
  });

  const asyncHumanInLoop = defineFixtureCommand({
    name: "async-human-in-loop",
    params: S.Object({ target: S.String() }),
    humanInLoop: {
      mode: "async",
      message: ({ params: values }) => `Queue ${values.target}?`
    },
    handler: async () => "deployed"
  });

  const rich = defineFixtureCommand({
    name: "rich",
    params: emptyParams,
    handler: async () => ({ value: "rich" }),
    render: {
      rich: (result, primitives) => {
        primitives.logger.info(`\u001b[31m${result.value}\u001b[0m`);
        primitives.logger.info(primitives.getTheme().intro("intro"));
        primitives.logger.info(
          primitives.renderTable({
            theme: primitives.getTheme(),
            variant: "detail",
            maxWidth: 24,
            columns: [
              { name: "label", title: "Label", alignment: "left", maxLen: 11 },
              { name: "value", title: "Value", alignment: "left", maxLen: 8 }
            ],
            rows: [
              {
                label: "Description",
                value:
                  "A deterministic renderer wraps this detail using a fixed eighty-column width."
              }
            ]
          })
        );
        primitives.note("captured note", "Capture");
      }
    }
  });

  const markdown = defineFixtureCommand({
    name: "markdown",
    params: emptyParams,
    handler: async () => ({ value: "markdown" }),
    render: {
      markdown: (result, primitives) => primitives.getTheme().header(`# ${result.value}`)
    }
  });

  const json = defineFixtureCommand({
    name: "json",
    params: emptyParams,
    handler: async () => ({ value: "json" }),
    render: {
      json: (result, primitives) => ({ value: primitives.getTheme().success(result.value) })
    }
  });

  const renderError = defineFixtureCommand({
    name: "render-error",
    params: emptyParams,
    handler: async () => "handled",
    render: {
      rich: (_result, primitives) => primitives.logger.info("rendered before failure"),
      markdown: () => {
        throw new Error("Fixture renderer failed.");
      }
    }
  });

  const service = defineFixtureCommand({
    name: "service",
    params: S.Object({ value: S.String() }),
    handler: async ({ fakeService, params: values }) => fakeService.execute(values.value)
  });

  const fs = defineFixtureCommand({
    name: "fs",
    params: emptyParams,
    handler: async ({ fs: handlerFs }) => {
      await handlerFs.writeFile("/result.txt", "written");
      return "written";
    }
  });

  const fsRoundTrip = defineFixtureCommand({
    name: "fs-roundtrip",
    params: emptyParams,
    handler: async ({ fs: handlerFs }) => {
      await handlerFs.writeFile("/roundtrip.txt", "written");
      return handlerFs.readFile("/roundtrip.txt");
    }
  });

  const effects = defineFixtureCommand({
    name: "effects",
    params: emptyParams,
    handler: async (context) => {
      context.diagnostics.emit({ level: "debug", message: "starting effects" });
      const envValue = context.env.get("FIXTURE_VALUE");
      context.progress("halfway");
      const serviceValue = await context.fakeService.execute(envValue ?? "missing");
      const response = await context.fetch("https://fixture.test/value", { method: "POST" });
      await context.fs.writeFile("/effects.txt", await response.text());
      return serviceValue;
    }
  });

  const alias = defineFixtureCommand({
    name: "canonical",
    aliases: ["alias"],
    params: emptyParams,
    handler: async () => "alias"
  });

  const hidden = defineFixtureCommand({
    name: "hidden",
    hidden: true,
    params: emptyParams,
    handler: async () => "hidden"
  });

  const defaultCommand = defineFixtureCommand({
    name: "show",
    params: emptyParams,
    handler: async () => "default"
  });

  const nested = defineGroup<FixtureServices>({
    name: "nested",
    children: [defaultCommand],
    default: defaultCommand
  });

  const deferred = defineGroup<FixtureServices>({
    name: "deferred",
    mcp: { transport: "stdio", command: "fixture-server" },
    children: []
  });

  const userError = defineFixtureCommand({
    name: "user-error",
    params: emptyParams,
    handler: async () => {
      throw new UserError("Fixture user error.");
    }
  });

  const notFound = defineFixtureCommand({
    name: "not-found",
    params: emptyParams,
    handler: async () => {
      throw new NotFoundError({
        request: { method: "GET", url: "https://fixture.test/missing", headers: {} },
        response: { status: 404, statusText: "Not Found", headers: {}, body: null }
      });
    }
  });

  const plainError = defineFixtureCommand({
    name: "plain-error",
    params: emptyParams,
    handler: async () => {
      throw new Error("Fixture plain error.");
    }
  });

  return defineGroup<FixtureServices>({
    name: "fixture",
    children: [
      params,
      secrets,
      otherSecrets,
      auth,
      check,
      confirm,
      humanInLoop,
      humanInLoopPath,
      asyncHumanInLoop,
      rich,
      markdown,
      json,
      renderError,
      service,
      fs,
      fsRoundTrip,
      effects,
      alias,
      hidden,
      nested,
      deferred,
      userError,
      notFound,
      plainError
    ] as unknown as CommandNode<FixtureServices>[]
  });
}
