import { createS3NamespaceFileSystem, type S3NamespaceOptions } from 'poe-code/safe-fs';
import { Shell } from '@poe-platform/safe-bash';
import { pythonCommands, type PythonCommandsOptions } from '@poe-platform/safe-bash/commands/python';

export async function namespacePythonShell(options: S3NamespaceOptions, python: PythonCommandsOptions): Promise<Shell> {
  return new Shell({ fs: await createS3NamespaceFileSystem(options) }).use(pythonCommands(python));
}
