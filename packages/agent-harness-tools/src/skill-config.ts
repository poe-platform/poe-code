export function skillPlanConfigSection(subcommand: string): string {
  return `## Plan Directory

Run \`poe-code ${subcommand} plan-path\` to get the resolved plan directory path.

Write the plan file to \`<plan-directory>/<name>.md\`.`;
}
