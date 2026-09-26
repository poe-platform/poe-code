import type { DatabaseProvider } from './contracts.js';
import { databases } from './databases.js';
import { PythonException } from './diagnostics/index.js';
import { CsvkitBlocked } from './errors.js';
import { integer, repr } from './cli/parser.js';

/** SQLAlchemy URL identity is separate from a WHATWG URL. Database paths are literal. */
export interface DatabaseUrl {
  readonly raw: string;
  readonly drivername: string;
  readonly dialect: string;
  readonly driver: string | null;
  readonly username: string | null;
  readonly password: string | null;
  readonly host: string | null;
  readonly port: number | bigint | null;
  readonly database: string | null;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
}

function unquote(text: string, plus = false): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < text.length;) {
    const pair = text.slice(index + 1, index + 3);
    if (text[index] === '%' && pair.length === 2 && [...pair].every(char => '0123456789abcdefABCDEF'.includes(char))) {
      bytes.push(Number.parseInt(pair, 16)); index += 3;
    } else {
      const char = String.fromCodePoint(text.codePointAt(index)!);
      bytes.push(...encoder.encode(plus && char === '+' ? ' ' : char)); index += char.length;
    }
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(bytes));
}

export function parseDatabaseUrl(raw: string): DatabaseUrl {
  const separator = raw.indexOf('://');
  const drivername = raw.slice(0, separator);
  if (separator > 0 && [...drivername].some(char => char.codePointAt(0)! > 127)) throw new CsvkitBlocked('Unicode database driver name grammar');
  if (separator < 1 || [...drivername].some(char => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_+'.includes(char)))
    throw new PythonException('ArgumentError', 'Could not parse SQLAlchemy URL from given URL string');
  let position = separator + 3;
  let username: string | null = null, password: string | null = null;
  // SQLAlchemy's greedy username excludes colon/slash, but can contain @.
  // A password ends at the first @; without a password the last username @ wins.
  let userEnd = position;
  while (userEnd < raw.length && !':/'.includes(raw[userEnd]!)) userEnd++;
  if (raw[userEnd] === ':') {
    const at = raw.indexOf('@', userEnd + 1);
    if (at >= 0) { username = unquote(raw.slice(position, userEnd)); password = unquote(raw.slice(userEnd + 1, at)); position = at + 1; }
  }
  if (username === null) {
    const at = raw.lastIndexOf('@', userEnd - 1);
    if (at >= position) { username = unquote(raw.slice(position, at)); position = at + 1; }
  }
  let host: string | null = null;
  if (raw[position] === '[') {
    let end = position + 1;
    while (end < raw.length && !'/?'.includes(raw[end]!)) end++;
    const bracket = raw.lastIndexOf(']', end - 1);
    if (bracket > position + 1) { host = raw.slice(position + 1, bracket); position = bracket + 1; }
  }
  if (host === null) {
    const start = position;
    while (position < raw.length && !'/:?'.includes(raw[position]!)) position++;
    host = raw.slice(start, position) || null;
  }
  let port: number | bigint | null = null;
  if (raw[position] === ':') {
    const start = ++position;
    while (position < raw.length && !'/?'.includes(raw[position]!)) position++;
    const token = raw.slice(start, position);
    if (token.length > 4300) throw new CsvkitBlocked('database URL port integer diagnostic limit');
    const value = integer(token);
    if (value === undefined) throw new PythonException('ValueError', `invalid literal for int() with base 10: ${repr(token)}`);
    port = value;
  }
  let database: string | null = null;
  if (raw[position] === '/') {
    const start = ++position;
    while (position < raw.length && raw[position] !== '?') position++;
    database = raw.slice(start, position);
  }
  const query: Record<string, string | readonly string[]> = Object.create(null) as Record<string, string | readonly string[]>;
  if (raw[position] === '?') {
    // The upstream query regex is not DOTALL: a physical newline ends its match.
    const text = raw.slice(position + 1).split('\n')[0]!;
    for (const field of text.split('&')) {
      const equals = field.indexOf('=');
      if (equals < 0 || equals === field.length - 1) continue;
      const key = unquote(field.slice(0, equals), true), value = unquote(field.slice(equals + 1), true);
      const previous = query[key];
      query[key] = previous === undefined ? value : Object.freeze(typeof previous === 'string' ? [previous, value] : [...previous, value]);
    }
  }
  const plus = drivername.indexOf('+');
  return Object.freeze({ raw, drivername, dialect: plus < 0 ? drivername : drivername.slice(0, plus), driver: plus < 0 ? null : drivername.slice(plus + 1), username, password, host, port, database, query: Object.freeze(query) });
}

/** Frozen csvkit create_engine ImportError wrapper, rather than a guessed DBAPI error. */
export const missingDatabaseDriver = "You don't appear to have the necessary database backend installed for connection string you're trying to use. Available backends include:\n\nPostgreSQL:\tpip install psycopg2\nMySQL:\t\tpip install mysql-connector-python OR pip install mysqlclient\n\nFor details on connection strings and other backends, please see the SQLAlchemy documentation on dialects at:\n\nhttps://www.sqlalchemy.org/docs/dialects/";

export function resolveDatabaseProvider(raw: string, providers: readonly DatabaseProvider[]): { readonly url: DatabaseUrl; readonly provider: DatabaseProvider } {
  const url = parseDatabaseUrl(raw);
  const dialect = databases.find(binding => (binding.name === url.dialect || binding.aliases?.includes(url.dialect)) && binding.drivers);
  const provider = providers.find(binding => binding.schemes.includes(url.drivername));
  if (provider) { dialect?.validateUrl?.(url); return { url, provider }; }
  const driver = url.driver ?? dialect?.defaultDriver;
  const descriptor = driver === undefined ? undefined : dialect?.drivers?.[driver];
  if (!descriptor) throw new PythonException('NoSuchModuleError', `Can't load plugin: sqlalchemy.dialects:${url.drivername.replaceAll('+', '.')}`);
  if (descriptor.referenceAvailable) { dialect?.validateUrl?.(url); throw new CsvkitBlocked(`database capability ${url.drivername}`); }
  throw new PythonException('ImportError', missingDatabaseDriver);
}
