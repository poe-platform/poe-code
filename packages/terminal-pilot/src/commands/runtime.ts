import { UserError } from "toolcraft";
import type { HandlerEnv } from "toolcraft";
import type { TerminalPilotInstallerServices } from "./installer.js";
import { TerminalPilot, type NewSessionOptions } from "../terminal-pilot.js";
import type { TerminalSession } from "../terminal-session.js";

export const SESSION_ENV_VAR = "TERMINAL_PILOT_SESSION";

type SessionLike = Pick<
  TerminalSession,
  | "id"
  | "command"
  | "pid"
  | "exitCode"
  | "fill"
  | "type"
  | "press"
  | "signal"
  | "waitFor"
  | "waitForExit"
  | "screen"
  | "history"
  | "resize"
  | "close"
>;

type PilotLike = Pick<TerminalPilot, "newSession" | "getSession" | "deleteSession" | "sessions">;
type ClosablePilotLike = PilotLike & Pick<TerminalPilot, "close">;

type NamedSession = {
  name: string;
  session: SessionLike;
};

type CreateSessionParams = NewSessionOptions & {
  session?: string;
};

export interface TerminalPilotRuntime {
  createSession(params: CreateSessionParams, env?: HandlerEnv): Promise<NamedSession>;
  resolveSession(name: string | undefined, env?: HandlerEnv): Promise<NamedSession>;
  closeSession(
    name: string | undefined,
    env?: HandlerEnv
  ): Promise<{ exitCode: number; name: string }>;
  listSessions(): Promise<NamedSession[]>;
  close(): Promise<void>;
}

export interface TerminalPilotCommandServices {
  terminalPilotRuntime?: TerminalPilotRuntime;
  terminalPilotInstaller?: TerminalPilotInstallerServices;
}

interface CreateTerminalPilotRuntimeOptions {
  launchPilot?: () => Promise<ClosablePilotLike>;
}

let sharedRuntime: TerminalPilotRuntime | undefined;

export function getTerminalPilotRuntime(
  runtime: TerminalPilotRuntime | undefined
): TerminalPilotRuntime {
  if (runtime !== undefined) {
    return runtime;
  }

  sharedRuntime ??= createTerminalPilotRuntime();
  return sharedRuntime;
}

export function createTerminalPilotRuntime(
  options: CreateTerminalPilotRuntimeOptions = {}
): TerminalPilotRuntime {
  const launchPilot = options.launchPilot ?? TerminalPilot.launch;
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  const pendingNames = new Set<string>();
  let pilotPromise: Promise<ClosablePilotLike> | undefined;

  function getRequestedName(name: string | undefined, env?: HandlerEnv): string | undefined {
    const requestedName = name ?? env?.get(SESSION_ENV_VAR);

    if (requestedName !== undefined && requestedName.trim().length === 0) {
      throw new UserError("Session name must not be empty.");
    }

    return requestedName;
  }

  async function getPilot(): Promise<ClosablePilotLike> {
    pilotPromise ??= launchPilot();
    return pilotPromise;
  }

  function nextSessionName(): string {
    let index = 1;

    while (nameToId.has(`s${index}`) || pendingNames.has(`s${index}`)) {
      index += 1;
    }

    return `s${index}`;
  }

  function rememberSession(name: string, session: SessionLike): NamedSession {
    nameToId.set(name, session.id);
    idToName.set(session.id, name);
    return { name, session };
  }

  function forgetSession(name: string, sessionId: string): void {
    if (nameToId.get(name) === sessionId) {
      nameToId.delete(name);
    }
    if (idToName.get(sessionId) === name) {
      idToName.delete(sessionId);
    }
  }

  function formatAvailableSessions(names: string[]): string {
    if (names.length === 0) {
      return "No active sessions are available.";
    }

    return `Available sessions: ${names.join(", ")}.`;
  }

  async function lookupNamedSession(name: string): Promise<NamedSession> {
    const sessionId = nameToId.get(name);

    if (sessionId === undefined) {
      const active = await listSessions();
      throw new UserError(
        `Session "${name}" was not found. ${formatAvailableSessions(active.map((entry) => entry.name))}`
      );
    }

    const pilot = await getPilot();

    try {
      return { name, session: pilot.getSession(sessionId) };
    } catch {
      forgetSession(name, sessionId);
      const active = await listSessions();
      throw new UserError(
        `Session "${name}" was not found. ${formatAvailableSessions(active.map((entry) => entry.name))}`
      );
    }
  }

  async function listSessions(): Promise<NamedSession[]> {
    const pilot = await getPilot();

    return pilot.sessions().flatMap((session) => {
      const name = idToName.get(session.id);

      if (name === undefined) {
        return [];
      }

      return [{ name, session }];
    });
  }

  async function discardExitedSessionName(name: string): Promise<void> {
    const sessionId = nameToId.get(name);
    if (sessionId === undefined) {
      return;
    }

    const pilot = await getPilot();
    try {
      const session = pilot.getSession(sessionId);
      if (session.exitCode === null) {
        return;
      }
      pilot.deleteSession(sessionId);
    } catch {
      // Missing sessions no longer reserve public names.
    }
    forgetSession(name, sessionId);
  }

  return {
    async createSession(params: CreateSessionParams, env?: HandlerEnv): Promise<NamedSession> {
      if (params.command.trim().length === 0) {
        throw new UserError("Command must not be empty.");
      }

      const requestedName = getRequestedName(params.session, env) ?? nextSessionName();

      await discardExitedSessionName(requestedName);

      if (nameToId.has(requestedName) || pendingNames.has(requestedName)) {
        throw new UserError(`Session "${requestedName}" already exists.`);
      }

      pendingNames.add(requestedName);
      try {
        const pilot = await getPilot();
        const session = await pilot.newSession({
          command: params.command,
          args: params.args,
          cwd: params.cwd,
          cols: params.cols,
          rows: params.rows,
          observe: params.observe
        });

        return rememberSession(requestedName, session);
      } finally {
        pendingNames.delete(requestedName);
      }
    },

    async resolveSession(name: string | undefined, env?: HandlerEnv): Promise<NamedSession> {
      const requestedName = getRequestedName(name, env);

      if (requestedName !== undefined) {
        return lookupNamedSession(requestedName);
      }

      const active = await listSessions();

      if (active.length === 1) {
        return active[0] as NamedSession;
      }

      if (active.length === 0) {
        throw new UserError("No active sessions. Create one with create-session.");
      }

      throw new UserError(
        `Multiple active sessions require an explicit session name. Pass --session or set ${SESSION_ENV_VAR}. ${formatAvailableSessions(active.map((entry) => entry.name))}`
      );
    },

    async closeSession(
      name: string | undefined,
      env?: HandlerEnv
    ): Promise<{ exitCode: number; name: string }> {
      const namedSession = await this.resolveSession(name, env);
      const exitCode = await namedSession.session.close();
      const pilot = await getPilot();

      pilot.deleteSession(namedSession.session.id);
      forgetSession(namedSession.name, namedSession.session.id);

      return {
        exitCode,
        name: namedSession.name
      };
    },
    listSessions,

    async close(): Promise<void> {
      if (pilotPromise === undefined) {
        return;
      }

      const pilot = await pilotPromise;
      await pilot.close();
      pilotPromise = undefined;
      nameToId.clear();
      idToName.clear();
      pendingNames.clear();
    }
  };
}

export async function closeSharedTerminalPilotRuntime(): Promise<void> {
  if (sharedRuntime === undefined) {
    return;
  }

  await sharedRuntime.close();
  sharedRuntime = undefined;
}
