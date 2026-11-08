import type { CommandNode } from "toolcraft";

export interface TokenSource {
  getToken(): Promise<string>;
  invalidate?(token?: string): Promise<void>;
}

export interface CommandContributor {
  commands: CommandNode<any>[];
}

export type AuthProvider = TokenSource & CommandContributor;
