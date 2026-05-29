import { randomUUID } from "node:crypto";
import { TerminalSession } from "./terminal-session.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

export interface NewSessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  observe?: boolean;
}

export class TerminalPilot {
  private readonly sessionMap = new Map<string, TerminalSession>();

  static async launch(): Promise<TerminalPilot> {
    return new TerminalPilot();
  }

  async newSession(opts: NewSessionOptions): Promise<TerminalSession> {
    const session = new TerminalSession({
      id: randomUUID(),
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env,
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      observe: opts.observe ?? false
    });

    this.sessionMap.set(session.id, session);
    return session;
  }

  getSession(id: string): TerminalSession {
    const session = this.sessionMap.get(id);

    if (session === undefined) {
      throw new Error(`Session not found: ${id}`);
    }

    return session;
  }

  deleteSession(id: string): void {
    this.sessionMap.delete(id);
  }

  sessions(): TerminalSession[] {
    return [...this.sessionMap.values()].filter((s) => s.exitCode === null);
  }

  async close(): Promise<void> {
    const sessions = [...this.sessionMap.values()];

    await Promise.all(
      sessions.map(async (session) => {
        await session.close();
        this.sessionMap.delete(session.id);
      })
    );
  }
}
