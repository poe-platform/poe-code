import * as native from "toolcraft-rust/agent-defs";
import * as reference from "toolcraft/agent-defs";

const forward: typeof reference = native;
const reverse: typeof native = reference;
const agent: native.AgentDefinition = reference.codexAgent;
const referenceAgent: reference.AgentDefinition = native.codexAgent;
const capabilities: readonly native.AgentCapability[] | undefined = agent.capabilities;
const specifier: native.AgentSpecifier = native.parseAgentSpecifier("codex:Provider/Model");
const argumentsList: string[] | undefined = native.codexAgent.otelCapture?.args?.(
  "https://example.com/traces",
  true
);
// @ts-expect-error Capability names form a closed public union.
native.listAgentsWithCapability("unknown");
// @ts-expect-error Telemetry content selection is a boolean.
native.codexAgent.otelCapture?.args?.("https://example.com/traces", "yes");
void [forward, reverse, agent, referenceAgent, capabilities, specifier, argumentsList];
