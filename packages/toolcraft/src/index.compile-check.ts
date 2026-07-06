import { S } from "toolcraft-schema";
import {
  ApprovalDeclinedError,
  UserError,
  defineCommand,
  defineGroup
} from "./index.js";
import { createFileChangeRenderers } from "./file-change-renderer.js";
import type {
  Command,
  Group,
  HandlerContext,
  HumanInLoopConfig,
  HumanInLoopPending,
  HumanInLoopRuntimeOptions,
  InferSecrets,
  Renderers,
  Requires,
  Scope,
  SecretDeclarations,
} from "./index.js";
import type {
  AnySchema,
  ArraySchema,
  BooleanSchema,
  EnumSchema,
  JsonSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  Static,
  StringSchema,
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredScope = ["cli", "sdk"] satisfies Scope[];
const ignoredSecrets = {
  apiKey: { env: "API_KEY" },
  sessionToken: { env: "SESSION_TOKEN", optional: true },
} satisfies SecretDeclarations;

const ignoredCommand = defineCommand({
  name: "deploy",
  params: S.Object({
    name: S.String(),
    force: S.Optional(S.Boolean()),
  }),
  secrets: ignoredSecrets,
  requires: {
    auth: true,
  },
  render: {
    json: (result) => result,
  },
  handler: async ({ params, secrets, fetch, fs, env, progress }) => {
    progress(params.name);
    await fs.exists("/tmp");
    env.get("HOME");
    void fetch;

    return {
      authenticated: Boolean(secrets.apiKey),
      force: params.force ?? false,
    };
  },
});

const ignoredFileChangeCommand = defineCommand({
  name: "status",
  params: S.Object({}),
  render: createFileChangeRenderers({ mode: "status" }),
  handler: async () => ({
    changes: [{ kind: "added" as const, path: "flows/morning.json", newContent: "{}\n" }]
  })
});

const ignoredGroup = defineGroup({
  name: "root",
  scope: ignoredScope,
  secrets: {
    rootToken: { env: "ROOT_TOKEN" },
  },
  children: [ignoredCommand],
  default: ignoredCommand,
});

const ignoredMcpGroup = defineGroup({
  name: "mcp-root",
  mcp: {
    transport: "stdio",
    command: "server",
  },
  children: [],
});

const ignoredToolsGroup = defineGroup({
  name: "tools-root",
  tools: ["usage"],
  children: [],
});

const ignoredRenameGroup = defineGroup({
  name: "rename-root",
  rename: {
    usage: "bot.create",
  },
  children: [],
});

const ignoredPlainGroup = defineGroup({
  name: "plain-root",
  children: [],
});

type ignoredCommandExport = AssertAssignable<Command<any, any, any, any>, typeof ignoredCommand>;
type ignoredFileChangeCommandExport = AssertAssignable<
  Command<any, any, any, any>,
  typeof ignoredFileChangeCommand
>;
type ignoredGroupExport = AssertAssignable<Group<any>, typeof ignoredGroup>;
type ignoredMcpGroupExport = AssertAssignable<Group<any>, typeof ignoredMcpGroup>;
type ignoredToolsGroupExport = AssertAssignable<Group<any>, typeof ignoredToolsGroup>;
type ignoredRenameGroupExport = AssertAssignable<Group<any>, typeof ignoredRenameGroup>;
type ignoredPlainGroupExport = AssertAssignable<Group<any>, typeof ignoredPlainGroup>;
type ignoredUserErrorExport = AssertAssignable<Error, UserError>;
type ignoredApprovalDeclinedErrorExport = AssertAssignable<UserError, ApprovalDeclinedError>;
type ignoredScopeExport = AssertAssignable<Scope[], typeof ignoredScope>;
type ignoredRequiresExport = AssertAssignable<
  Requires<any>,
  NonNullable<typeof ignoredCommand.requires>
>;
type ignoredRenderersExport = AssertAssignable<
  Renderers<{ authenticated: boolean; force: boolean }>,
  NonNullable<typeof ignoredCommand.render>
>;
type ignoredInferSecretsExport = AssertAssignable<
  { apiKey: string; sessionToken?: string },
  InferSecrets<typeof ignoredSecrets>
>;
type ignoredHandlerContextTypeExport = AssertAssignable<
  HandlerContext<any, typeof ignoredSecrets>,
  Parameters<typeof ignoredCommand.handler>[0]
>;
type ignoredHandlerContextExport = AssertAssignable<
  {
    params: { name: string; force?: boolean };
    secrets: { apiKey: string; sessionToken?: string };
    fetch: typeof globalThis.fetch;
    fs: {
      readFile(path: string, encoding?: BufferEncoding): Promise<string>;
      writeFile(path: string, contents: string): Promise<void>;
      exists(path: string): Promise<boolean>;
    };
    env: { get(key: string): string | undefined };
    diagnostics: {
      level: "silent" | "error" | "warn" | "info" | "debug" | "trace";
      emit(event: {
        level: "error" | "warn" | "info" | "debug" | "trace";
        message: string;
      }): void;
    };
    progress(message: string): void;
  },
  Parameters<typeof ignoredCommand.handler>[0]
>;
type ignoredHumanInLoopRuntimeOptionsExport = AssertAssignable<
  {
    provider?: {
      id: string;
      requestApproval(request: {
        message: string;
        declineInputPrompt?: string;
      }): Promise<{ outcome: "approved" } | { outcome: "declined"; reason?: string }>;
    };
    taskList?:
      | {
          list(name: string): {
            all(filter?: { state?: string; includeArchived?: boolean }): Promise<unknown[]>;
            get(id: string): Promise<unknown>;
            create(input: {
              id: string;
              name: string;
              description?: string;
              metadata?: Record<string, unknown>;
            }): Promise<unknown>;
            fire(id: string, event: string, opts?: { metadataPatch?: Record<string, unknown> }): Promise<unknown>;
            canFire(id: string, event: string): Promise<boolean>;
            events(id: string): Promise<readonly string[]>;
          };
          lists(): Promise<string[]>;
          allTasks(filter?: { state?: string; includeArchived?: boolean }): Promise<unknown[]>;
          get(qualifiedId: string): Promise<unknown>;
        }
      | {
          dir: string;
          format: "markdown-dir" | "yaml-file";
        };
    listName?: string;
    binPath?: { execPath: string; entryArgs: readonly string[] };
  },
  HumanInLoopRuntimeOptions
>;
type ignoredHumanInLoopPendingExport = AssertAssignable<
  { status: "pending-approval"; approvalId: string; message: string; enqueuedAt: string },
  HumanInLoopPending
>;

const ignoredStringSchema = S.String();
const ignoredNumberSchema = S.Number();
const ignoredBooleanSchema = S.Boolean();
const ignoredEnumSchema = S.Enum(["cli", "sdk"] as const);
const ignoredArraySchema = S.Array(S.String());
const ignoredObjectSchema = S.Object({
  name: S.String(),
  enabled: S.Optional(S.Boolean()),
});
const ignoredOptionalSchema = S.Optional(S.Number());

type ignoredHumanInLoopConfigExport = AssertAssignable<
  {
    mode: "sync" | "async";
    message: ({ params, commandPath }: { params: { name: string }; commandPath: string }) => string;
    plan?: ({ params, commandPath }: { params: { name: string }; commandPath: string }) =>
      | unknown
      | Promise<unknown>;
    declineInputPrompt?: string;
  },
  HumanInLoopConfig<typeof ignoredObjectSchema>
>;

type ignoredAnySchemaExport = AssertAssignable<AnySchema, typeof ignoredStringSchema>;
type ignoredStringSchemaExport = AssertAssignable<StringSchema, typeof ignoredStringSchema>;
type ignoredNumberSchemaExport = AssertAssignable<NumberSchema, typeof ignoredNumberSchema>;
type ignoredBooleanSchemaExport = AssertAssignable<BooleanSchema, typeof ignoredBooleanSchema>;
type ignoredEnumSchemaExport = AssertAssignable<
  EnumSchema<readonly ["cli", "sdk"]>,
  typeof ignoredEnumSchema
>;
type ignoredArraySchemaExport = AssertAssignable<ArraySchema<StringSchema>, typeof ignoredArraySchema>;
type ignoredObjectSchemaExport = AssertAssignable<
  ObjectSchema<{ name: StringSchema; enabled: OptionalSchema<BooleanSchema> }>,
  typeof ignoredObjectSchema
>;
type ignoredOptionalSchemaExport = AssertAssignable<
  OptionalSchema<NumberSchema>,
  typeof ignoredOptionalSchema
>;
type ignoredStaticExport = AssertAssignable<
  { name: string; enabled?: boolean },
  Static<typeof ignoredObjectSchema>
>;
type ignoredJsonSchemaExport = AssertAssignable<
  JsonSchema,
  {
    type?: "string" | "number" | "boolean" | "array" | "object";
    description?: string;
    default?: unknown;
    enum?: ReadonlyArray<string | number | boolean>;
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
  }
>;
