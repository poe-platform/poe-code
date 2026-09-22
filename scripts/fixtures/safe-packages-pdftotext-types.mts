import { createPdftotextCommand, pdftotext, pdftotextCommands, type PdftotextRunOptions, type PdftotextResult } from '@poe-platform/safe-bash/commands/pdftotext';
import type { CommandContext, CommandDefinition } from '@poe-platform/safe-bash';
const options: PdftotextRunOptions = { input: '-literal.pdf', output: '-', numbers: { resolution: 144 }, flags: { raw: true }, userPassword: 'cli-profile' };
const command: CommandDefinition = createPdftotextCommand({ maxOutputBytes: 65536 });
pdftotextCommands({ replace: true });
async function run(context: CommandContext): Promise<PdftotextResult> { return pdftotext(context, options); }
void command; void run;
