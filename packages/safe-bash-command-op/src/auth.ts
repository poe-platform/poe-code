import type { OpAuthenticationPolicy, OpBackendContext, OpBackendRequest, OpClock, OpObject, OpSession } from "./types.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) return left.length === right.length && left.every((value, index) => value === right[index]);
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameData(value, right[index]));
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameData(left[key], right[key]));
}

function sameAuthorization(left: OpObject | undefined, right: OpObject | undefined): boolean {
  return left !== undefined && right !== undefined && sameData({ ...left, lastActivityAt: 0 }, { ...right, lastActivityAt: 0 });
}

function suspendedUser(session: OpObject, resources: ReadonlyMap<string, readonly OpObject[]>): boolean {
  return typeof session.user === "string" && (resources.get("user") ?? []).some(user => user.id === session.user && user.state === "SUSPENDED");
}

export function validateAuthentication(resources: ReadonlyMap<string, readonly OpObject[]>, policy: OpAuthenticationPolicy): void {
  if (!["managed", "object-store"].includes(policy.mode)) throw new Error("Invalid authentication policy");
  const sessions = resources.get("session") ?? [];
  const defaults = resources.get("session default") ?? [];
  const appDefaults = resources.get("app default") ?? [];
  if (policy.mode !== "managed" && (sessions.length || defaults.length || appDefaults.length)) throw new Error("Session state requires explicit managed authentication migration");
  const accounts = resources.get("account") ?? [];
  if (appDefaults.length > 1 || appDefaults.some(entry => typeof entry.id !== "string" || !entry.id || !accounts.some(account => account.id === entry.account))) throw new Error("Invalid app account preference");
  const tokens = new Set<string>();
  const ids = new Set<string>();
  for (const session of sessions) {
    if (typeof session.id !== "string" || !session.id || ids.has(session.id.toLowerCase())) throw new Error("Invalid session ID");
    ids.add(session.id.toLowerCase());
    if (typeof session.account !== "string" || !accounts.some(account => account.id === session.account)) throw new Error("Invalid session account");
    if (![session.issuedAt, session.lastActivityAt].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) || Number(session.lastActivityAt) < Number(session.issuedAt)) throw new Error("Session timestamps require explicit migration");
    if (session.revokedAt !== undefined && (typeof session.revokedAt !== "number" || !Number.isFinite(session.revokedAt) || session.revokedAt < Number(session.issuedAt))) throw new Error("Invalid session revocation");
    if (session.mode === "manual") {
      if (typeof session.token !== "string" || !session.token || tokens.has(session.token)) throw new Error("Invalid manual session token");
      tokens.add(session.token);
    } else if (session.mode === "app") {
      if (typeof session.terminalId !== "string" || !session.terminalId || session.token !== undefined) throw new Error("Invalid app authorization");
    } else throw new Error("Session mode requires explicit migration");
    if (session.user !== undefined && (typeof session.user !== "string" || !(resources.get("user") ?? []).some(user => user.id === session.user))) throw new Error("Invalid session user");
  }
  const terminals = new Set<string>();
  for (const entry of defaults) {
    if (typeof entry.terminalId !== "string" || !entry.terminalId || terminals.has(entry.terminalId) || !accounts.some(account => account.id === entry.account)) throw new Error("Invalid terminal account selection");
    terminals.add(entry.terminalId);
  }
}

export function inspectAuthentication(request: OpBackendRequest, context: OpBackendContext, source: Map<string, OpObject[]>, policy: OpAuthenticationPolicy, clock: OpClock) {
  if (request.resource === "app default") throw new Error("App preference is updated only by signin");
  validateAuthentication(source, policy);
  const managed = policy.mode === "managed";
  const command = request.action ? `${request.resource} ${request.action}` : request.resource;
  const local = ["signin", "signout", "account add", "account list", "account forget", "item template list", "item template get", "plugin list", "plugin inspect", "plugin clear", "completion"].includes(command);
  const terminalId = context.authentication?.terminalId;
  const integration = context.authentication?.integration === undefined ? "manual" : context.authentication.integration;
  if (integration !== "manual" && integration !== "app") throw new Error("Invalid authentication integration mode");
  if (terminalId !== undefined && (typeof terminalId !== "string" || !terminalId)) throw new Error("Invalid authentication terminal identity");
  const admittedAt = clock.now();
  if (!Number.isFinite(admittedAt) || admittedAt < 0) throw new Error("Invalid authentication clock");
  const accounts = source.get("account") ?? [];
  const selectAccount = (selector: unknown): string => {
    if (typeof selector !== "string" || !selector) throw new Error("Account selection is required");
    const folded = selector.toLowerCase();
    const ids = accounts.filter(account => account.id.toLowerCase() === folded);
    const matches = ids.length ? ids : accounts.filter(account => [account.name, account.title, account.email, account.shorthand, account.url, account.address, account.user_uuid, account.userId].some(value => typeof value === "string" && value.toLowerCase() === folded));
    if (matches.length !== 1) throw new Error("Account selection is required");
    return matches[0]!.id;
  };
  let account = request.flags.account === undefined ? undefined : selectAccount(request.flags.account);
  let session: OpSession | undefined;
  const sessions = (source.get("session") ?? []) as OpSession[];
  if (request.flags.session !== undefined) {
    session = sessions.find(entry => entry.mode === "manual" && entry.token === request.flags.session);
    if (!session || (account !== undefined && account !== session.account)) throw new Error("Invalid session");
    account = session.account;
  } else if (managed) {
    account ??= (integration === "app" ? source.get("app default")?.[0]?.account : (source.get("session default") ?? []).find(entry => entry.terminalId === terminalId)?.account) as string | undefined;
    if (!local || command === "signin") {
      if (local && !account && accounts.length === 1 && integration === "manual") account = accounts[0]!.id;
      if (!local && !account) throw new Error("Account selection is required");
      session = integration === "app" ? sessions.filter(entry => entry.account === account && entry.mode === "app" && entry.terminalId === terminalId).sort((left, right) => right.issuedAt - left.issuedAt)[0] : undefined;
      if (!session && !local) throw new Error("No authenticated session");
    }
  }
  if (session && suspendedUser(session, source)) throw new Error("Session user is suspended");
  if (session && (session.revokedAt !== undefined || admittedAt < session.lastActivityAt || admittedAt - session.lastActivityAt >= (session.mode === "manual" ? 1_800_000 : 600_000) || (session.mode === "app" && admittedAt - session.issuedAt >= 43_200_000))) {
    if (["signin", "signout", "account forget"].includes(command)) session = undefined;
    else throw new Error("Session expired or revoked");
  }
  const global = request.resource === "account" && (["list", "add"].includes(request.action) || request.action === "forget" && (request.args.length > 0 || request.flags.all === true)) || request.resource === "signout" && request.flags.all === true || request.resource === "item template";
  const scopedRequest = account !== undefined && !global ? { ...request, flags: { ...request.flags, account } } : request;
  if (managed && !global && account === undefined && (integration === "app" || !["signin", "signout"].includes(command) || accounts.length > 1)) throw new Error("Account selection is required");
  return { request: scopedRequest, session, command, local, admittedAt, account, terminalId, integration };
}

export function beginAuthentication(request: OpBackendRequest, context: OpBackendContext, source: Map<string, OpObject[]>, policy: OpAuthenticationPolicy, clock: OpClock) {
  const { request: scopedRequest, session, command, local, admittedAt, account, terminalId, integration } = inspectAuthentication(request, context, source, policy, clock);
  const original = structuredClone(source);
  const resources = structuredClone(source);
  let signedIn: { session: OpSession; nextId: () => string } | undefined;
  return {
    request: scopedRequest,
    resources,
    sessionId: session?.id,
    recordSignin(granted: OpSession, nextId: () => string) {
      if (!["signin", "account add"].includes(command)) throw new Error("Unexpected signin result");
      signedIn = { session: structuredClone(granted), nextId };
    },
    commit() {
      context.signal.throwIfAborted();
      if (session && (suspendedUser(session, source) || !sameAuthorization(session, (source.get("session") ?? []).find(entry => entry.id === session.id)))) throw new Error("Authorization changed during operation");
      if (["signin", "account add"].includes(command) && terminalId !== undefined) {
        const defaults = resources.get("session default") ?? [];
        const selected = defaults.filter(entry => entry.terminalId === terminalId).at(-1);
        if (selected) resources.set("session default", defaults.filter(entry => entry.terminalId !== terminalId || entry === selected));
      }
      validateAuthentication(resources, policy);
      const candidate = new Map(source);
      for (const [resource, objects] of resources) {
        const before = original.get(resource) ?? [];
        if (sameData(objects, before)) continue;
        const initial = new Map(before.map(entry => [entry.id.toLowerCase(), entry]));
        const proposed = new Map(objects.map(entry => [entry.id.toLowerCase(), entry]));
        const current = new Map((source.get(resource) ?? []).map(entry => [entry.id.toLowerCase(), entry]));
        for (const id of new Set([...initial.keys(), ...proposed.keys()])) {
          if (sameData(initial.get(id), proposed.get(id))) continue;
          if (!sameData(initial.get(id), current.get(id)) && !(resource === "session" && sameAuthorization(initial.get(id), current.get(id)))) throw new Error(command === "plugin clear" && resource === "plugin" ? "Plugin changed during confirmation" : "Object changed during authenticated operation");
          const replacement = proposed.get(id);
          if (replacement) current.set(id, resource === "session" && sameAuthorization(replacement, current.get(id)) ? { ...replacement, lastActivityAt: Math.max(Number(replacement.lastActivityAt), Number(current.get(id)!.lastActivityAt)) } : replacement);
          else current.delete(id);
        }
        candidate.set(resource, [...current.values()]);
      }
      const invalidatedUsers = new Set((candidate.get("user") ?? []).filter(user => {
        const previous = (source.get("user") ?? []).find(entry => entry.id === user.id);
        return previous?.state !== user.state && (previous?.state === "SUSPENDED" || user.state === "SUSPENDED");
      }).map(user => user.id));
      if (invalidatedUsers.size) candidate.set("session", (candidate.get("session") ?? []).filter(entry => typeof entry.user !== "string" || !invalidatedUsers.has(entry.user)));
      for (const entry of candidate.get("session") ?? []) {
        if (suspendedUser(entry, candidate) && !sameAuthorization(entry, (source.get("session") ?? []).find(existing => existing.id === entry.id))) throw new Error("Cannot authorize a suspended user");
      }
      if (signedIn) {
        const grantedId = signedIn.session.id;
        const granted = (candidate.get("session") ?? []).find(entry => entry.id === grantedId) as OpSession | undefined;
        const mode = request.flags.session === undefined ? integration : "manual";
        const signedInAt = clock.now();
        if (!Number.isFinite(signedInAt) || signedInAt < admittedAt || !granted || !sameAuthorization(granted, signedIn.session) || granted.mode !== mode || (account !== undefined && granted.account !== account) || suspendedUser(granted, candidate) || granted.revokedAt !== undefined || signedInAt < granted.lastActivityAt || signedInAt - granted.lastActivityAt >= (granted.mode === "app" ? 600_000 : 1_800_000) || (granted.mode === "app" && (terminalId === undefined || granted.terminalId !== terminalId || signedInAt - granted.issuedAt >= 43_200_000))) throw new Error("Invalid signin authorization");
        const key = granted.mode === "app" ? "app default" : "session default";
        if (granted.mode === "app" || terminalId !== undefined) {
          const matches = (entries: readonly OpObject[]) => granted.mode === "app" ? entries : entries.filter(entry => entry.terminalId === terminalId);
          if (!sameData(matches(original.get(key) ?? []), matches(source.get(key) ?? []))) throw new Error("Account preference changed during signin");
          const defaults = candidate.get(key) ?? [];
          const existing = matches(defaults)[0];
          let id = existing?.id;
          while (id === undefined) {
            const proposed = signedIn.nextId();
            if (![...candidate.values()].some(entries => entries.some(entry => entry.id.toLowerCase() === proposed.toLowerCase() || [entry.fields, entry.sections, entry.files].some(children => Array.isArray(children) && children.some(child => record(child) && typeof child.id === "string" && child.id.toLowerCase() === proposed.toLowerCase()))))) id = proposed;
          }
          const preference = { id, account: granted.account, ...(granted.mode === "manual" ? { terminalId } : {}) };
          candidate.set(key, [...(granted.mode === "app" ? [] : defaults.filter(entry => entry.terminalId !== terminalId)), preference]);
        }
      }
      if (session && (!local || command === "signin")) {
        const current = (candidate.get("session") ?? []).find(entry => entry.id === session.id) as OpSession | undefined;
        if (current && current.revokedAt === undefined && sameAuthorization(current, session)) {
          candidate.set("session", (candidate.get("session") ?? []).map(entry => entry === current ? { ...current, lastActivityAt: Math.max(current.lastActivityAt, admittedAt) } : entry));
        }
      }
      validateAuthentication(candidate, policy);
      for (const [resource, objects] of candidate) source.set(resource, objects);
    },
  };
}
