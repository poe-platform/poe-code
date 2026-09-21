import { native } from "./native.js";
import { defineProvider } from "./types.js";
import { orderAuthProviders } from "./provider-order.js";
export const catalog = native.providerCatalog().map(defineProvider);
export const allAuthProviders = orderAuthProviders(catalog);
