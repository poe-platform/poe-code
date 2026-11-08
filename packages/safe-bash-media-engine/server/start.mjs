// This executable requires a trusted, explicitly mounted operator module.
// Importing the media frontend or starting a virtual shell never runs it.
import {runMediaServer} from '../dist/server-command.js';

try {
  await runMediaServer(process.argv.slice(2));
} catch {
  process.exitCode = 1;
  process.stderr.write('Remote media server startup failed. Supply one absolute operator configuration module with a pinned deployment and explicit HTTPS service configuration.\n');
}
