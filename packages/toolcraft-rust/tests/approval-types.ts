import * as native from "toolcraft-rust/human-in-loop";
import * as reference from "toolcraft/human-in-loop";
import { S, defineCommand, defineGroup } from "../dist/index.js";
import { createSDK } from "toolcraft-rust/sdk";
import { mockProvider } from "@poe-code/agent-human-in-loop-rust";
const a: typeof reference = native;
const b: typeof native = reference;
const humanInLoop = native.createHumanInLoop({ provider: mockProvider({ outcome: "approved" }) });
const root = defineGroup({ name: "app", children: [defineCommand({ name: "deploy",
  params: S.Object({ revision: S.Number() }), humanInLoop: { mode: "sync", message: (ctx: { params: { revision: number } }) => String(ctx.params.revision) },
  handler: ctx => ctx.params.revision })] as const });
const result: Promise<number> = createSDK(root, { humanInLoop }).deploy({ revision: 42 });
void [a, b, result];
