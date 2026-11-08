import { createPlaywrightCli, createPlaywrightController, PlaywrightCheckpointError, PlaywrightResourceLimitError, type PlaywrightCliOptions, type PlaywrightAdapter } from '@poe-platform/safe-bash/commands/playwright';
import { createPlaywrightCli as alias, type PlaywrightControllerOptions } from '@poe-platform/safe-bash/playwright';
declare const adapter: PlaywrightAdapter;
const options: PlaywrightCliOptions = { adapter, replace: false };
const controllerOptions: PlaywrightControllerOptions = options;
const cli = createPlaywrightCli(options);
const equivalent: typeof createPlaywrightCli = alias;
const controller = createPlaywrightController(controllerOptions);
void [cli.plugin, cli.restoreSession, controller.inspectSessions, equivalent, PlaywrightCheckpointError, PlaywrightResourceLimitError];
