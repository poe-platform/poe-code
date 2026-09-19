import type { SqlTransportProfile } from './descriptor.js';
import { mysql } from './mysql.js';
export const mariadb: SqlTransportProfile = {
  ...mysql, name: 'mariadb-positional-v1',
  schemes: ['mariadb', 'mariadb+mariadbconnector', 'mariadb+pymysql', 'mysql+mariadbconnector'],
};
