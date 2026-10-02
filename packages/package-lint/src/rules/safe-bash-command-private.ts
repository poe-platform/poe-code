import type { Rule, Violation } from "../model.js";

const prefix = "safe-bash-command-";

/** Command implementations are shipped through safe-bash, never independently. */
export const safeBashCommandPrivate: Rule = {
  id: "safe-bash-command-private",
  run(model) {
    const violations: Violation[] = [];
    for (const pkg of model.packages) {
      const directory = pkg.dir.split("/").at(-1)!;
      if (!pkg.name.startsWith(prefix) && !directory.startsWith(prefix)) continue;
      if (pkg.private && pkg.name === directory && pkg.name.length > prefix.length) continue;
      violations.push({
        rule: this.id, package: pkg.name, severity: "error",
        detail: { private: pkg.private, directory },
        message: "Safe Bash command workspaces must be private and use matching safe-bash-command-<name> directory and manifest names",
        fix: 'Use matching safe-bash-command-<name> names and "private": true; expose the command through an explicit safe-bash subpath.'
      });
    }
    for (const pkg of model.packages.filter(pkg => pkg.dir === "packages/safe-bash")) {
      for (const ref of model.sourceImports.get(pkg.dir) ?? []) {
        if (ref.isTest || !ref.file.startsWith(pkg.dir + "/src/commands/") || !ref.packageName || !model.byName.has(ref.packageName)) continue;
        const name = ref.packageName;
        if (name.startsWith(prefix) || name.startsWith("safe-bash-") && name.endsWith("-engine") ||
            name === "safe-bash-contracts" || name === "@poe-code/safe-fs" || name.endsWith("-ast")) continue;
        violations.push({
          rule: this.id, package: pkg.name, severity: "error", via: ref.file,
          detail: { dependency: name },
          message: "Safe Bash command facades must import conventionally named command or engine workspaces",
          fix: "Move the implementation to a private safe-bash-command-<name> workspace or a shared safe-bash-<name>-engine."
        });
      }
    }
    return violations;
  }
};
