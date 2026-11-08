import type { DatabaseProvider, DatabaseSession, SqlValue } from './contracts.js';
import { parseDatabaseUrl, type DatabaseUrl } from './database-url.js';
import { CsvkitBlocked } from './errors.js';

export interface DatabaseCredentials {
  readonly username: string | null;
  readonly password: string | null;
}
/** A trusted adapter reviews both the name and actual semantics of each mapping. */
export interface DatabaseOptionMapping {
  readonly target: string;
  readonly convert: (value: unknown) => unknown;
}
export interface DatabaseConnectionRequest {
  readonly url: DatabaseUrl;
  readonly credentials: DatabaseCredentials;
  readonly options: Readonly<Record<string, unknown>>;
  readonly cwd: string;
}
/** Explicit host capabilities; a descriptor does not load a driver or infer authority. */
export interface DatabaseProviderDescriptor {
  readonly schemes: readonly string[];
  readonly profile: string;
  readonly transport: 'local' | 'network';
  readonly credentials?: DatabaseCredentials;
  readonly engineOptions?: Readonly<Record<string, DatabaseOptionMapping>>;
  readonly executionOptions?: Readonly<Record<string, DatabaseOptionMapping>>;
  readonly authorize: (request: DatabaseConnectionRequest, signal: AbortSignal) => Promise<boolean>;
  readonly connect: (request: DatabaseConnectionRequest, signal: AbortSignal) => Promise<DatabaseSession>;
}

function optionMappings(input: Readonly<Record<string, DatabaseOptionMapping>> | undefined): Readonly<Record<string, DatabaseOptionMapping>> {
  const output: Record<string, DatabaseOptionMapping> = Object.create(null) as Record<string, DatabaseOptionMapping>;
  const targets = new Set<string>();
  for (const [name, mapping] of Object.entries(input ?? {})) {
    if (!name || !mapping.target || typeof mapping.convert !== 'function' || targets.has(mapping.target)) throw new TypeError('database option mappings require unique targets and explicit conversions');
    targets.add(mapping.target); output[name] = Object.freeze({ ...mapping });
  }
  return Object.freeze(output);
}

function mappedOptions(input: Readonly<Record<string, unknown>>, mappings: Readonly<Record<string, DatabaseOptionMapping>>, kind: 'engine' | 'execution'): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, value] of Object.entries(input)) {
    // The shared engine supplies this SQLAlchemy execution default. It controls
    // parameter interpolation, and must survive adapters without constructor access.
    if (kind === 'execution' && name === 'no_parameters') {
      if (typeof value !== 'boolean') throw new CsvkitBlocked('database no_parameters option must be Boolean');
      output[name] = value; continue;
    }
    const mapping = Object.hasOwn(mappings, name) ? mappings[name] : undefined;
    if (!mapping) throw new CsvkitBlocked(`unreviewed database ${kind} option ${name}`);
    output[mapping.target] = mapping.convert(value);
  }
  return Object.freeze(output);
}

export function createDatabaseProvider(descriptor: DatabaseProviderDescriptor): DatabaseProvider {
  if (!descriptor.profile || !descriptor.schemes.length || descriptor.schemes.some(scheme => !scheme) || typeof descriptor.authorize !== 'function' || typeof descriptor.connect !== 'function')
    throw new TypeError('database provider requires schemes, profile, authorization and an explicit driver binding');
  const schemes = Object.freeze([...descriptor.schemes]), profile = descriptor.profile;
  const engineMappings = optionMappings(descriptor.engineOptions), executionMappings = optionMappings(descriptor.executionOptions);
  for (const [name, mapping] of Object.entries(executionMappings)) {
    if (name === 'no_parameters' || mapping.target === 'no_parameters') throw new TypeError('reserved database execution option no_parameters');
  }
  const credentials = descriptor.credentials === undefined ? undefined : Object.freeze({ ...descriptor.credentials });
  const authorize = descriptor.authorize, connect = descriptor.connect;
  return Object.freeze({ schemes, profile,
    async connect(raw: string, options: Readonly<Record<string, unknown>>, signal: AbortSignal, invocation?: { readonly cwd: string }): Promise<DatabaseSession> {
      signal.throwIfAborted();
      const url = parseDatabaseUrl(raw);
      if (!schemes.includes(url.drivername)) throw new CsvkitBlocked(`database provider scheme ${url.drivername}`);
      const request: DatabaseConnectionRequest = Object.freeze({ url,
        credentials: Object.freeze(url.username !== null || url.password !== null ? { username: url.username, password: url.password } : credentials ?? { username: null, password: null }),
        options: mappedOptions(options, engineMappings, 'engine'), cwd: invocation?.cwd ?? '/' });
      signal.throwIfAborted();
      const allowed = await authorize(request, signal);
      signal.throwIfAborted();
      if (allowed !== true) throw new CsvkitBlocked('database endpoint authorization');
      const session = await connect(request, signal);
      if (signal.aborted) {
        // A cooperative late acquisition remains owned until both cleanup stages
        // settle. Preserve the caller's abort identity even if cleanup fails.
        try { await session.rollback(); } catch { /* Original cancellation wins. */ }
        try { await session.close(); } catch { /* Original cancellation wins. */ }
        signal.throwIfAborted();
      }
      return {
        profile: session.profile, ...(session.dialect === undefined ? {} : { dialect: session.dialect }),
        ...(session.sqlDialect === undefined ? {} : { sqlDialect: session.sqlDialect }),
        begin: session.begin.bind(session), commit: session.commit.bind(session), rollback: session.rollback.bind(session), close: session.close.bind(session),
        ...(session.hasTable === undefined ? {} : { hasTable: session.hasTable.bind(session) }),
        ...(session.executeMany === undefined ? {} : { executeMany: session.executeMany.bind(session) }),
        query(sql: string, values: readonly SqlValue[], options: Readonly<Record<string, unknown>>, signal: AbortSignal) {
          signal.throwIfAborted();
          return session.query(sql, values, mappedOptions(options, executionMappings, 'execution'), signal);
        }
      };
    }
  });
}
