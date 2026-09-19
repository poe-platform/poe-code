import type { SqlTransportProfile } from './descriptor.js';
import { postgresqlValue } from '../sql-transport-values.js';
export const postgresql: SqlTransportProfile = {
  name: 'postgresql-positional-v1', dialect: 'postgresql',
  schemes: ['postgresql', 'postgresql+psycopg2', 'postgresql+psycopg'],
  parameter: index => '$' + (index + 1), bindValue: postgresqlValue,
  reflection: (name, schema) => ({
    sql: 'SELECT c.relname FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE c.relname = $1 AND c.relkind IN (\'r\', \'p\', \'v\', \'m\', \'f\') AND ' + (schema === null ? 'pg_catalog.pg_table_is_visible(c.oid) AND n.nspname != \'pg_catalog\'' : 'n.nspname = $2'),
    values: schema === null ? [name] : [name, schema]
  })
};
