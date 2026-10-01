import * as native from "../dist/index.js";
import * as reference from "../../toolcraft/dist/index.js";
import { createSDK } from "../../toolcraft/dist/sdk.js";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";

const define: typeof reference.defineCommand = native.defineCommand;
const group: typeof reference.defineGroup = native.defineGroup;
const clone: typeof reference.cloneCommandNode = native.cloneCommandNode;
const nativeDefine: typeof native.defineCommand = reference.defineCommand;
const nativeGroup: typeof native.defineGroup = reference.defineGroup;
void [define, group, clone, nativeDefine, nativeGroup];

const sensitive: typeof reference.isSensitiveName = native.isSensitiveName;
const redact: typeof reference.redactHttpBody = native.redactHttpBody;
void [sensitive, redact];

// Compare the declared stream signatures with the same type parameters. Asking
// TS to re-infer services across two recursive copies instead infers the entire
// contravariant stream context as the native service type.
function streamSignatures<
  Services extends object,
  Name extends string,
  Params extends ObjectSchema<any>,
  Secrets extends native.SecretDeclarations | undefined,
  Event extends AnySchema,
  Scope extends readonly native.Scope[] | undefined
>() {
  const actual: typeof reference.defineStreamCommand<
    Services,
    Name,
    Params,
    Secrets,
    Event,
    Scope
  > = native.defineStreamCommand<Services, Name, Params, Secrets, Event, Scope>;
  const expected: typeof native.defineStreamCommand<Services, Name, Params, Secrets, Event, Scope> =
    reference.defineStreamCommand<Services, Name, Params, Secrets, Event, Scope>;
  void [actual, expected];
}
void streamSignatures;

const command = native.defineCommand({
  name: "read-item",
  params: S.Object({ value: S.String() }),
  secrets: { required: { env: "TOKEN" }, optional: { env: "OTHER", optional: true } },
  scope: ["sdk"] as const,
  handler: (context) => {
    const value: string = context.params.value;
    const required: string = context.secrets.required;
    const optional: string | undefined = context.secrets.optional;
    void [required, optional];
    return { length: value.length };
  }
});
const root = native.defineGroup({ name: "root", children: [command] as const });
const sdk = createSDK(native.cloneCommandNode(root));
const result: Promise<{ length: number }> = sdk.readItem({ value: "test" });
void result;
// @ts-expect-error parameters preserve the schema's input types
sdk.readItem({ value: 1 });
// @ts-expect-error cloned group retains literal child names
sdk.missing({});

const watch = native.defineStreamCommand({
  name: "watch",
  params: S.Object({}),
  event: S.Number(),
  async *handler(ctx) {
    const signal: AbortSignal = ctx.signal;
    void signal;
    yield 1;
  }
});
const eventSchema: typeof watch.stream = undefined;
void eventSchema;

const watchSDK = createSDK(native.defineGroup({ name: "root", children: [watch] as const }));
const events: reference.ToolcraftStream<number> = watchSDK.watch({});
void events;
