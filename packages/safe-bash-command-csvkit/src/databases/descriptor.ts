import type { CsvWriteCell } from "../csv.js";
import type { SqlValue } from "../contracts.js";
/** Frozen SQLAlchemy DDL metadata; this does not provide a database driver. */
export interface DatabaseDialectDescriptor {
  readonly name: string;
  /** URL registry aliases; do not add schema-only CLI dialect choices. */
  readonly aliases?: readonly string[];
  /** Frozen SQLAlchemy driver registry. Metadata grants no connection authority. */
  readonly defaultDriver?: string;
  readonly drivers?: Readonly<Record<string, { readonly module: string; readonly referenceAvailable?: boolean }>>;
  readonly validateUrl?: (url: import('../database-url.js').DatabaseUrl) => void;
  readonly default?: boolean;
  readonly quoteStart: string;
  readonly quoteEnd: string;
  readonly reserved: readonly string[];
  readonly illegalInitial: readonly string[];
  readonly typedTypes?: Readonly<Partial<Record<"Boolean" | "Number" | "TimeDelta" | "Date" | "DateTime" | "Text", string>>>;
  readonly textType?: string;
  readonly textLength?: boolean;
  readonly textLengthLimit?: number;
  readonly numericPrecision?: number;
  readonly timestampNullable?: string;
  /** Only a qualified driver bind profile enables product inserts. */
  readonly bindValue?: (value: CsvWriteCell) => SqlValue;
  readonly placeholder?: string;
  readonly parameter?: (index: number) => string;
  readonly nullable?: string;
  readonly doublePercent?: boolean;
  /** SQLAlchemy's bracket-aware database/owner schema grammar. */
  readonly multipartSchema?: boolean;
}
