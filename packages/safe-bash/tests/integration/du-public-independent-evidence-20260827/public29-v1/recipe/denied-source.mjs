import { readFileSync } from 'node:fs';
readFileSync(process.env.DU_FORBIDDEN_SOURCE);
throw new Error('SOURCE_FALLBACK_PERMISSION_WAS_NOT_DENIED');
