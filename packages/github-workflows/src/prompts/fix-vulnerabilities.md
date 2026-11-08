---
label: "Scheduled: Fix Vulnerabilities"
source: >-
  gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] |
  select(.state=="open")]'
agent: claude-code
# Source fields: number, dependency.package.{name,ecosystem}, dependency.manifest_path,
#   security_advisory.{ghsa_id,summary,severity,description},
#   security_vulnerability.first_patched_version.identifier (first safe version)
---

Fix {{dependency.package.name}} ({{security_advisory.severity}}): {{security_advisory.summary}}

{{skill_github_cli}}

{{pull_request_guidelines}}

{{response_style}}

{{verify_before_responding}}
