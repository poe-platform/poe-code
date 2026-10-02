import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNativeStorageSources } from '../../safe-bash-command-playwright-cli/scripts/generate-native-storage-sources.mjs';
export { renderNativeStorageSources } from '../../safe-bash-command-playwright-cli/scripts/generate-native-storage-sources.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateNativeStorageSources();
