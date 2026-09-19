import type { Runtime } from '../runtime.js';
import { databases } from '../databases.js';
import type { DatabaseDialectDescriptor } from '../databases/descriptor.js';
import type { TypedTable, ColumnType } from '../table/index.js';
import type { TextTable } from '../text-table.js';
import { CsvkitBlocked, CsvkitDiagnostic } from '../errors.js';
import { Decimal } from '../types/decimal.js';
import { pythonValueText } from '../csv.js';

export type SqlTable = TypedTable | TextTable;
export type SqlWork = Pick<Runtime, 'step' | 'retain'>;
export interface SqlColumnSchema {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly nullableSuffix: string;
}
export interface SqlTableSchema {
  readonly name: string;
  readonly schema: string | null;
  readonly columns: readonly SqlColumnSchema[];
  readonly unique: readonly string[];
}

function typeName(column: ColumnType, dialect: DatabaseDialectDescriptor): string | undefined {
  return (column === 'Text' ? dialect.textType : undefined) ?? dialect.typedTypes?.[column] ??
    databases.find(binding => binding.default)?.typedTypes?.[column];
}

export function identifier(name: string, dialect: DatabaseDialectDescriptor, runtime: SqlWork): string {
  runtime.step();
  if (!name) throw new CsvkitDiagnostic('IndexError: string index out of range');
  // CPython re.I adds dotless i and long s to the ASCII character class.
  // Its '$' anchor also accepts one final LF, as SQLAlchemy's frozen regex does.
  const legal = 'abcdefghijklmnopqrstuvwxyz0123456789_$ıſ';
  const candidate = name.endsWith('\n') ? name.slice(0, -1) : name;
  const quote = !candidate || dialect.illegalInitial.includes(name[0]!) || dialect.reserved.includes(name.toLowerCase()) ||
    name.toLowerCase() !== name || [...candidate].some(char => !legal.includes(char));
  if (!quote) return name;
  runtime.retain(name.length * 4 + 16);
  const escaped = name.split(dialect.quoteEnd).join(dialect.quoteEnd + dialect.quoteEnd);
  return dialect.quoteStart + (dialect.doublePercent ? escaped.split('%').join('%%') : escaped) + dialect.quoteEnd;
}

/** Frozen SQLAlchemy _schema_elements grammar, selected through provider metadata. */
export function schemaIdentifier(name: string, dialect: DatabaseDialectDescriptor, runtime: SqlWork): string {
  if (!dialect.multipartSchema || name.startsWith('__[SCHEMA_')) return identifier(name, dialect, runtime);
  runtime.retain(name.length * 8 + 64);
  const parts: string[] = [];
  let symbol = '', bracket = false, hasBrackets = false;
  for (const char of name) {
    runtime.step();
    if (char === '[') { bracket = true; hasBrackets = true; }
    else if (char === ']') bracket = false;
    else if (char === '.' && !bracket) {
      parts.push(hasBrackets ? '[' + symbol + ']' : symbol);
      symbol = ''; hasBrackets = false;
    } else symbol += char;
  }
  if (symbol) parts.push(symbol);
  const owner = parts.at(-1);
  let database = parts.slice(0, -1).join('.');
  // The reference re.match's dots do not cross LF. Internal bracket groups
  // preserve a quoted_name(quote=False), rather than being escaped again.
  const interior = database.slice(1, -1).split('\n', 1)[0]!;
  const closing = interior.indexOf(']');
  const raw = closing >= 0 && interior.indexOf('[', closing + 1) >= 0;
  if (!raw) {
    while (database.startsWith('[')) database = database.slice(1);
    while (database.endsWith(']')) database = database.slice(0, -1);
  }
  if (database) return (raw ? database : identifier(database, dialect, runtime)) + '.' + identifier(owner!, dialect, runtime);
  return owner ? identifier(owner, dialect, runtime) : '';
}

export function deriveSchema(runtime: Pick<Runtime, 'options' | 'step' | 'retain'>, table: SqlTable, name: string, dialect: DatabaseDialectDescriptor, connected: boolean): SqlTableSchema {
  const o = runtime.options;
  const unique = o.unique_constraint ? [...new Set(String(o.unique_constraint).split(','))] : [];
  const missing = unique.find(column => !table.headers.includes(column));
  if (missing !== undefined) throw new CsvkitDiagnostic(`ConstraintColumnNotFoundError: Can't create UniqueConstraint on table '${name}': no column named '${missing}' is present.`);
  const columns: SqlColumnSchema[] = [];
  for (const [column, header] of table.headers.entries()) {
    runtime.step();
    const columnType = 'columns' in table ? table.columns[column]!.type : 'Text';
    let type = typeName(columnType, dialect);
    if (!type) throw new CsvkitBlocked(`typed SQL ${columnType} dialect profile ${dialect.name}`);
    if (dialect.textLength && columnType === 'Text' && !o.no_constraints) {
      let length = 0;
      for (const row of table.rows) { runtime.step(); length = Math.max(length, Array.from(pythonValueText(row[column] ?? null)).length); }
      // agate-sql multiplies by Decimal(multiplier), under precision 28.
      // Lengths remain integral, but large products must round before comparison.
      const product = Decimal.parse(String(length)).multiply(Decimal.parse(connected ? String(o.col_len_multiplier) : '1'));
      const multiplied = product.coefficient * 10n ** BigInt(product.exponent) * (product.negative ? -1n : 1n);
      const minimum = connected ? BigInt(o.min_col_len as number | bigint) : 1n;
      type = dialect.textLengthLimit !== undefined && multiplied > BigInt(dialect.textLengthLimit) ? 'TEXT' : type + `(${multiplied >= minimum ? multiplied : minimum})`;
    }
    if (columnType === 'Number' && dialect.numericPrecision && !o.no_constraints) {
      let whole = 1, fractional = 0;
      for (const row of table.rows) {
        runtime.step();
        const value = row[column];
        if (!value || typeof value !== 'object' || value.kind !== 'decimal') continue;
        // Agate's math.isinf/math.isnan checks convert Decimal to binary64 first.
        // Finite Decimals outside that range do not participate in MaxPrecision.
        if (!Number.isFinite(Number(value.value))) continue;
        const decimal = Decimal.parse(value.value).normalized();
        if (decimal.special) continue;
        whole = Math.max(whole, decimal.coefficient.toString().length + decimal.exponent);
        fractional = Math.max(fractional, -decimal.exponent);
      }
      type += `(${dialect.numericPrecision}, ${Math.min(fractional, 28 - whole)})`;
    }
    const required = columnType !== 'DateTime' && !o.no_constraints && table.rows.every(row => { runtime.step(); return row[column] !== null; });
    columns.push(Object.freeze({ name: header, type, required, nullableSuffix: (columnType === 'DateTime' ? dialect.timestampNullable : undefined) ?? dialect.nullable ?? '' }));
    runtime.retain(64 + (header.length + type.length) * 4);
  }
  return Object.freeze({ name, schema: o.db_schema ? String(o.db_schema) : null, columns: Object.freeze(columns), unique: Object.freeze(unique) });
}

/** SQLAlchemy CreateTable's untrimmed bytes. The csvkit schema-only caller strips them. */
export function compileCreateTable(runtime: SqlWork, schema: SqlTableSchema, dialect: DatabaseDialectDescriptor): { readonly qualified: string; readonly statement: string } {
  const qualified = (schema.schema ? schemaIdentifier(schema.schema, dialect, runtime) + '.' : '') + identifier(schema.name, dialect, runtime);
  const fields = schema.columns.map(column => {
    runtime.step();
    if (dialect.textLength && column.type === typeName('Text', dialect)) {
      throw new CsvkitDiagnostic(`CompileError: (in table '${schema.name}', column '${column.name}'): ${column.type} requires a length on dialect ${dialect.name}`);
    }
    return identifier(column.name, dialect, runtime) + ' ' + column.type + (column.required ? ' NOT NULL' : column.nullableSuffix);
  });
  if (schema.unique.length) fields.push('UNIQUE (' + schema.unique.map(column => identifier(column, dialect, runtime)).join(', ') + ')');
  const statement = '\nCREATE TABLE ' + qualified + ' (\n' + (fields.length ? '\t' + fields.join(', \n\t') + '\n' : '') + ')\n\n';
  runtime.retain(statement.length * 4 + 64);
  return { qualified, statement };
}
