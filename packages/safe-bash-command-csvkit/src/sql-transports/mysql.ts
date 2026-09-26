import type { SqlTransportProfile } from './descriptor.js';
import { numericBooleanValue } from '../sql-transport-values.js';
export const mysql: SqlTransportProfile = {
  name: 'mysql-positional-v1', dialect: 'mysql',
  schemes: ['mysql', 'mysql+mysqldb', 'mysql+pymysql', 'mysql+mysqlconnector'],
  parameter: () => '?', bindValue: numericBooleanValue,
  reflection: (name, schema) => {
    const quote = (value: string): string => '`' + value.split('`').join('``') + '`';
    return { sql: 'DESCRIBE ' + (schema === null ? '' : quote(schema) + '.') + quote(name), values: [] };
  },
  missingTable: error => Boolean(error && typeof error === 'object' && 'errno' in error && error.errno === 1146)
};
