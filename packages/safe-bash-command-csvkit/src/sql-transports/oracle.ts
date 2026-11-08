import type { SqlTransportProfile } from './descriptor.js';
import { oracleValue } from '../sql-transport-values.js';
import { oracle as compiler } from '../databases/oracle.js';
export const oracle: SqlTransportProfile = {
  name: 'oracle-named-v1', dialect: 'oracle', schemes: ['oracle', 'oracle+cx_oracle', 'oracle+oracledb'],
  parameter: index => ':p' + (index + 1), bindValue: oracleValue,
  reflection: (name, schema) => {
    // SQLAlchemy denormalizes ordinary lower-case identifiers for Oracle catalogs.
    const normalize = (value: string): string => value === value.toLowerCase() && !compiler.reserved.includes(value) && [...value].every(char => 'abcdefghijklmnopqrstuvwxyz0123456789_$'.includes(char)) && 'abcdefghijklmnopqrstuvwxyz'.includes(value[0] ?? '') ? value.toUpperCase() : value;
    return { sql: 'SELECT table_name FROM all_tables WHERE table_name = :p1 AND owner = ' + (schema === null ? "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')" : ':p2') + ' UNION ALL SELECT view_name FROM all_views WHERE view_name = :p1 AND owner = ' + (schema === null ? "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')" : ':p2'), values: schema === null ? [normalize(name)] : [normalize(name), normalize(schema)] };
  }
};
