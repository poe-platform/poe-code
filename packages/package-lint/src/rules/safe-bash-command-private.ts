import type { Rule } from "../model.js";

/** Command implementations are shipped through safe-bash, never independently. */
export const safeBashCommandPrivate: Rule = {
  id: "safe-bash-command-private",
  run(model) {
    return model.packages.filter(pkg => pkg.name.startsWith("safe-bash-command-") && !pkg.private).map(pkg => ({
      rule: "safe-bash-command-private",
      package: pkg.name,
      severity: "error" as const,
      detail: { private: pkg.private },
      message: "Safe Bash command workspaces must be private",
      fix: 'Set "private": true; expose the command through an explicit safe-bash subpath.'
    }));
  }
};
