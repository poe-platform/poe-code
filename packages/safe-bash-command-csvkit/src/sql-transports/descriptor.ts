import type { CsvWriteCell } from '../csv.js';
import type { SqlValue } from '../contracts.js';

/** Named transport metadata. No driver discovery, loading or endpoint authority. */
export interface SqlTransportProfile {
  readonly name: string;
  readonly dialect: string;
  readonly schemes: readonly string[];
  readonly parameter: (index: number) => string;
  readonly bindValue: (value: CsvWriteCell) => SqlValue;
  readonly reflection: (name: string, schema: string | null) => { readonly sql: string; readonly values: readonly SqlValue[] };
  readonly missingTable?: (error: unknown) => boolean;
  readonly open?: (driver: import('../sql-native.js').SqlNativeDriver, request: import('../database-provider.js').DatabaseConnectionRequest, signal: AbortSignal) => Promise<import('../sql-transport.js').SqlTransportConnection>;
}
