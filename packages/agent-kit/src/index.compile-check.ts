import { S } from "agent-kit-schema";
import { UserError, defineCommand, defineGroup } from "./index.js";
import type {
  Command,
  Group,
  HandlerContext,
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

const ignoredGroup = defineGroup({
  name: "root",
  scope: ignoredScope,
  secrets: {
    rootToken: { env: "ROOT_TOKEN" },
  },
  children: [ignoredCommand],
  default: ignoredCommand,
});

type ignoredCommandExport = AssertAssignable<Command<any, any, any, any>, typeof ignoredCommand>;
type ignoredGroupExport = AssertAssignable<Group<any>, typeof ignoredGroup>;
type ignoredUserErrorExport = AssertAssignable<Error, UserError>;
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
    progress(message: string): void;
  },
  Parameters<typeof ignoredCommand.handler>[0]
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
