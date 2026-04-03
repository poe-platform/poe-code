---
# Installed by: poe-code github-workflows install fix-vulnerabilities
# Edit this file to customize the automation prompt and configuration.
label: "Scheduled: Fix Vulnerabilities"
source: >-
  gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] |
  select(.state=="open")]'
agent: claude-code
# Available variables (each sourced Dependabot alert):
#   {{number}}                                          - alert number
#   {{dependency.package.name}}                         - vulnerable package name
#   {{dependency.package.ecosystem}}                    - ecosystem (e.g. npm)
#   {{dependency.manifest_path}}                        - path to manifest (e.g. package.json)
#   {{security_advisory.ghsa_id}}                       - advisory ID
#   {{security_advisory.summary}}                       - short description
#   {{security_advisory.severity}}                      - low | medium | high | critical
#   {{security_advisory.description}}                   - full advisory description
#   {{security_vulnerability.first_patched_version.identifier}} - first safe version
---
Fix {{dependency.package.name}} ({{security_advisory.severity}}): {{security_advisory.summary}}
