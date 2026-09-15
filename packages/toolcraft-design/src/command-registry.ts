export interface DesignCommand { id: string; label: string; keys: readonly string[]; enabled?: () => boolean; run: () => void }
export function createCommandRegistry(commands: readonly DesignCommand[]) {
  const bindings = new Map<string, DesignCommand>();
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id)) throw new Error(`Duplicate command: ${command.id}`);
    ids.add(command.id);
    for (const key of command.keys) {
      if (bindings.has(key)) throw new Error(`Duplicate binding: ${key}`);
      bindings.set(key, command);
    }
  }
  return {
    dispatch(key: string): boolean {
      const command = bindings.get(key);
      if (!command || command.enabled?.() === false) return false;
      command.run(); return true;
    },
    list(): DesignCommand[] { return commands.filter(command => command.enabled?.() !== false); }
  };
}
