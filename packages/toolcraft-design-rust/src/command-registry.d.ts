export interface DesignCommand {
  id: string;
  label: string;
  keys: readonly string[];
  enabled?: () => boolean;
  run: () => void;
}
export declare function createCommandRegistry(commands: readonly DesignCommand[]): {
  dispatch(key: string): boolean;
  list(): DesignCommand[];
};
