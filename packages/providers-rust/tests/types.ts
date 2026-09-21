import * as own from "../dist/index.js";
import type * as original from "@poe-code/providers";
type Public = Exclude<keyof typeof original, "ProviderRegistry">;
const a: Pick<typeof original, Public> = own;
const b: Pick<typeof own, Public> = null as unknown as Pick<typeof original, Public>;
const registryA: Pick<original.ProviderRegistry, keyof original.ProviderRegistry> =
  new own.ProviderRegistry([]);
const registryB: Pick<own.ProviderRegistry, keyof own.ProviderRegistry> =
  null as unknown as original.ProviderRegistry;
void [a, b, registryA, registryB];
