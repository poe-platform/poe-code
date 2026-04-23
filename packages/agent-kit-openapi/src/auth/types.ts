import type { CommandNode } from "toolcraft";

export interface TokenSource {
  getToken(): Promise<string>;
  invalidate?(): Promise<void>;
}

export interface CommandContributor {
  commands: CommandNode<any>[];
}

export type AuthProvider = TokenSource & CommandContributor;
