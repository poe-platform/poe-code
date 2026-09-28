export * from "safe-bash-command-dos2unix";
// Keep runtime exports explicit when bundles share the external command module.
export {
  createDos2unixCommand,
  createUnix2dosCommand,
  createDos2unixCommands,
  dos2unixCommands,
  createDos2unixCommands as createLineEndingCommands,
  dos2unixCommands as lineEndingCommands,
} from "safe-bash-command-dos2unix";
