export interface PeerDeclarationBinding {
  name: string;
  version: string;
  integrity: string | null;
  directory: string;
  profile: "checkout-root" | "registry-release";
  qualification: string;
  metadataSha256: string;
  exports: Record<string, unknown>;
  declarations: Map<string, string>;
  publicEntries: Map<string, string>;
  privateEntries: Map<string, string>;
}

export function createPeerBinding(
  root: string,
  manifest: { peerDependenciesMeta?: Record<string, { optional?: boolean }> },
  declarations?: Map<string, string>,
  publicImports?: string[],
): PeerDeclarationBinding;
