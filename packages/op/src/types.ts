import type { OpAdminContext } from "./admin.js";
import type { OpSelectPlugin } from "./host-contracts.js";

export interface OpBackendRequest {
  resource: string;
  action: string;
  args: readonly string[];
  flags: Readonly<Record<string, string | boolean | readonly string[]>>;
  input?: unknown;
}

export interface OpBackendContext {
  signal: AbortSignal;
  readonly binding?: OpBindingHandle;
  readonly authentication?: Readonly<OpAuthenticationContext>;
  readonly pluginScope?: PluginScopeContext;
  readonly selectPlugin?: OpSelectPlugin;
  readonly confirmPluginClear?: (confirmation: PluginClearConfirmation, context: { readonly signal: AbortSignal }) => boolean | Promise<boolean>;
}

declare const bindingBrand: unique symbol;

export interface OpBindingHandle {
  readonly [bindingBrand]: true;
}

export interface OpBindingTarget {
  readonly requestIndex: number;
  readonly resource: string;
  readonly kind: "object" | "collection" | "field" | "section";
  readonly id?: string;
  readonly account?: string;
  readonly parentId?: string;
  readonly revision: string;
}

export interface OpBindingPrepareContext extends OpBackendContext {
  readonly expiresAt?: number;
}

export interface OpPreparedBinding {
  readonly backendId: string;
  readonly accountId: string | null;
  readonly handle: OpBindingHandle;
  readonly targets: readonly OpBindingTarget[];
  readonly metadata: readonly OpBindingRequestMetadata[];
}

export interface OpBindingRequestMetadata {
  readonly environment?: {
    readonly names: readonly string[];
    readonly unsetNames?: readonly string[];
    readonly scope?: "complete" | "selected";
    readonly dependenciesComplete: boolean;
  };
}

export type PluginScope =
  | { readonly kind: "global" }
  | { readonly kind: "directory"; readonly path: string }
  | { readonly kind: "terminal"; readonly terminalSession: string };

export interface PluginScopeContext {
  readonly cwd: string;
  readonly home: string;
  readonly terminalSession?: string;
}

export interface PluginDefault {
  readonly id: string;
  readonly scope: PluginScope;
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface PluginClearConfirmation {
  readonly pluginId: string;
  readonly defaults: readonly { readonly id: string; readonly scope: PluginScope }[];
}

export interface OpBackend {
  execute(request: OpBackendRequest, context: OpBackendContext): Promise<unknown>;
  prepareBinding?(requests: readonly OpBackendRequest[], context: OpBindingPrepareContext): Promise<OpPreparedBinding>;
  validateBinding?(handle: OpBindingHandle, context: OpBackendContext): void | Promise<void>;
  cancelBinding?(handle: OpBindingHandle): void;
}

export interface OpObjectBackend extends OpBackend {
  execute(request: OpBackendRequest, context: OpAdminContext): Promise<unknown>;
  prepareBinding(requests: readonly OpBackendRequest[], context: OpBindingPrepareContext): Promise<OpPreparedBinding>;
  validateBinding(handle: OpBindingHandle, context: OpBackendContext): void;
  cancelBinding(handle: OpBindingHandle): void;
  snapshot(): OpObjectBackendOptions;
}

export interface OpObject {
  id: string;
  name?: string;
  title?: string;
  [key: string]: unknown;
}

export interface OpObjectReference {
  id: string;
  name?: string;
}

export interface OpAccount extends OpObject {
  email?: string;
  url?: string;
}

export interface OpClock {
  now(): number;
}

export interface OpAuthenticationContext {
  terminalId?: string;
  integration?: "manual" | "app";
}

export interface OpAppAccountSelection extends OpObject {
  account: string;
}

export type OpSession = OpObject & {
  account: string;
  user?: string;
  identity?: unknown;
  issuedAt: number;
  lastActivityAt: number;
  revokedAt?: number;
} & ({ mode: "manual"; token: string } | { mode: "app"; terminalId: string });

export interface OpTerminalAccount extends OpObject {
  account: string;
  terminalId: string;
}

export interface OpAuthenticationPolicy {
  mode: "object-store" | "managed";
}

export interface OpVault extends OpObject {
  name: string;
  account?: string | OpObjectReference;
  description?: string;
}

export interface OpSection extends OpObject {
  label?: string;
}

export interface OpField extends OpObject {
  reference?: string;
  label?: string;
  type?: string;
  purpose?: string;
  value?: string;
  section?: OpSection;
}

export interface OpFile extends OpObject {
  name: string;
  content?: string | Uint8Array;
  size?: number;
  type?: string;
  section?: OpSection;
}

export interface OpItemInput extends OpObject {
  title: string;
  vault: string | OpObjectReference;
  category?: string;
  state?: "ACTIVE" | "ARCHIVED" | "DELETED";
  fields?: readonly OpField[];
  sections?: readonly OpSection[];
  files?: readonly OpFile[];
  tags?: readonly string[];
}

export interface OpItem extends OpItemInput {
  vault: OpObjectReference;
}

export interface OpDocument extends OpObject {
  vault?: string | OpObjectReference;
  content?: string | Uint8Array;
  state?: "ACTIVE" | "ARCHIVED" | "DELETED";
  tags?: readonly string[];
}

export interface OpObjectBackendOptions {
  defaultVault?: string;
  authentication?: OpAuthenticationPolicy;
  clock?: OpClock;
  ssh?: {
    generate: (type: string) => Promise<{ category: "SSH_KEY"; fields: readonly OpField[] }>;
    transform: (source: string, format: "openssh" | "pkcs1" | "pkcs8") => string | Promise<string>;
  };
  adminHooks?: OpAdminContext["adminHooks"];
  vaults?: readonly OpVault[];
  items?: readonly OpItemInput[];
  documents?: readonly OpDocument[];
  accounts?: readonly OpAccount[];
  resources?: Readonly<Record<string, readonly OpObject[]>>;
}

export interface OpSecretReference {
  vault: string;
  item: string;
  section?: string;
  field: string;
  query?: Readonly<Record<string, string>>;
}
