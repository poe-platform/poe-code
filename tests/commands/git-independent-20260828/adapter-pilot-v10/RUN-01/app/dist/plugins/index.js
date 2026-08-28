import { CommandRegistry } from "../contracts/index.js";
import { createStandardCommands } from "../commands/index.js";
import { diagnostic } from "../commands/internal.js";
import { createTextProgramCommands } from "../commands/text-programs/index.js";
import { createStructuredCommands } from "../commands/structured/index.js";
import { createSearchCommands } from "../commands/search/index.js";
import { createByteCommands } from "../commands/bytes/index.js";
import { createDiffPatchCommands } from "../commands/diff-patch/index.js";
import { createMetadataCommands } from "../commands/metadata/index.js";
import { createArchiveCommands } from "../commands/archive/index.js";
import { createTableTextCommands } from "../commands/table-text/index.js";
import { createStreamInspectionCommands } from "../commands/stream-inspection/index.js";
import { createStreamFormatCommands } from "../commands/stream-format/index.js";
import { createSplitCommands } from "../commands/split/index.js";
import { createTimeEnvCommands } from "../commands/time-env/index.js";
import { createTreeCommands } from "../commands/tree/index.js";
import { createFileCommands } from "../commands/file/index.js";
import { createGrepAliasCommands } from "../commands/grep-aliases/index.js";
import { createColumnCommands } from "../commands/column/index.js";
import { createHtmlToMarkdownCommands } from "../commands/html-to-markdown/index.js";
import { createDuCommands } from "../commands/du/index.js";
import { createExprCommands } from "../commands/expr/index.js";
import { createWhichCommands } from "../commands/which/index.js";
import { createTimeoutCommands } from "../commands/timeout/index.js";
function executor(lookup) {
    return async (context) => {
        const command = lookup(context.command);
        if (command)
            return command.execute(context);
        await diagnostic(context, new Error("command not found"));
        return { exitCode: 127 };
    };
}
export function createAgentCommands(options = {}) {
    const commands = [];
    const exprLimits = options.expr?.limits;
    const whichLimits = options.which?.limits;
    const timeoutOptions = options.timeout;
    commands.push(...createStandardCommands({ execute: options.execute ?? executor(name => commands.find(command => command.name === name)), ...(options.regex === undefined ? {} : { regex: options.regex }) }), ...createTextProgramCommands({ ...options.text }), ...createStructuredCommands({ ...options.structured }), ...createSearchCommands({ ...options.search }), ...createByteCommands(), ...createDiffPatchCommands({ ...options.diffPatch }), ...createMetadataCommands({ ...options.metadata }), ...createArchiveCommands({ ...options.archive }), ...createTableTextCommands({ ...options.tableText }), ...createStreamInspectionCommands({ ...options.streamInspection }), ...createStreamFormatCommands({ ...options.streamFormat }), ...createSplitCommands({ ...options.split }), ...createTimeEnvCommands({ ...options.timeEnv }), ...createTreeCommands({ ...options.tree }), ...createFileCommands({ ...options.file }), ...createGrepAliasCommands(options.regex === undefined ? {} : { regex: options.regex }), ...createColumnCommands({ ...options.column }), ...createHtmlToMarkdownCommands({ ...options.htmlToMarkdown }), ...createDuCommands({ ...options.du }), ...createExprCommands({ ...(exprLimits === undefined ? {} : { limits: exprLimits }), ...(options.regex === undefined ? {} : { regex: options.regex }) }), ...createWhichCommands(whichLimits === undefined ? {} : { limits: whichLimits }), ...createTimeoutCommands(timeoutOptions === undefined ? undefined : {
        invoke: timeoutOptions.invoke,
        scheduler: timeoutOptions.scheduler,
        maxTimerMilliseconds: timeoutOptions.maxTimerMilliseconds,
    }));
    return new CommandRegistry(commands).list();
}
export function agentCommands(options = {}) {
    return {
        name: "agent-commands",
        setup(host) {
            const definitions = createAgentCommands({ ...options, execute: options.execute ?? executor(name => host.commands.get(name)) });
            if (!options.replace)
                for (const definition of definitions) {
                    if (host.commands.has(definition.name))
                        throw new Error(`Command already registered: ${definition.name}`);
                }
            for (const definition of definitions)
                host.commands.register(definition, { replace: options.replace ?? false });
        },
    };
}
//# sourceMappingURL=index.js.map