import type { PeerDeclarationBinding } from "../../../scripts/typecheck-consumers.mjs";
import type * as filesystem from "node:fs";

export type PeerArtifactFileSystem = Pick<typeof filesystem,
  "existsSync" | "lstatSync" | "mkdirSync" | "readFileSync" | "readdirSync" | "realpathSync" | "writeFileSync"
>;

export interface PeerArtifactBinding {
  readonly profile: "checkout-root" | "packed-root" | "registry-release";
  readonly qualification: string;
  readonly version: string;
  readonly integrity: string | null;
  readonly tarballSha256: string | null;
  readonly metadataSha256: string;
  readonly entries: Readonly<Record<string, string>>;
  readonly runtimeFiles: number;
  readonly declarationFiles: number;
  readonly files: readonly Readonly<{ path: string; sha256: string }>[];
}

export function bindPeerArtifact(options: {
  root: string;
  artifact?: string;
  declarations?: { peer?: PeerDeclarationBinding };
  checkout?: boolean;
  io?: PeerArtifactFileSystem;
}): PeerArtifactBinding;
