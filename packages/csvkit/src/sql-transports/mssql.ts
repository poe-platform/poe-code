import type { SqlTransportProfile } from './descriptor.js';
import { numericBooleanValue } from '../sql-transport-values.js';
export const mssql: SqlTransportProfile = {
  name: 'mssql-named-v1', dialect: 'mssql', schemes: ['mssql', 'mssql+pyodbc', 'mssql+pymssql'],
  parameter: index => '@p' + (index + 1), bindValue: numericBooleanValue,
  reflection: (name, schema) => {
    if (name.startsWith('#')) return { sql: "SELECT name FROM tempdb.sys.tables WHERE object_id = OBJECT_ID('tempdb..' + @p1, 'U')", values: [name] };
    const parts: string[] = [];
    let part = '', bracketed = false;
    for (let index = 0; index < (schema?.length ?? 0); index++) {
      const char = schema![index]!;
      if (char === '[' && !bracketed) bracketed = true;
      else if (char === ']' && bracketed) {
        if (schema![index + 1] === ']') { part += ']'; index++; }
        else bracketed = false;
      } else if (char === '.' && !bracketed) { parts.push(part); part = ''; }
      else part += char;
    }
    if (schema !== null) parts.push(part);
    const owner = parts.pop();
    const quote = (value: string): string => '[' + value.split(']').join(']]') + ']';
    const catalog = parts.length ? quote(parts.join('.')) + '.' : '';
    return { sql: 'SELECT TABLE_NAME FROM ' + catalog + 'INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @p1 AND TABLE_SCHEMA = ' + (owner === undefined ? 'SCHEMA_NAME()' : '@p2'), values: owner === undefined ? [name] : [name, owner] };
  }
};
