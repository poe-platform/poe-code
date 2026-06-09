import type { LandingPageView } from "../render.js";

export const ACME_LANDING_PAGE: LandingPageView = {
  title: "acme",
  description: "Acme command reference",
  name: "acme",
  headline: "Define once. Run everywhere.",
  tagline: "One command tree for every surface.",
  accent: "#7a00c2",
  install: "npm install -g acme",
  version: "1.4.0",
  repoUrl: "https://github.com/acme/acme",
  surfaceCount: 3,
  commandCount: 2,
  groupCount: 1,
  surfaces: [
    { name: "CLI", description: "Terminal commands.", example: "acme deploy prod api" },
    {
      name: "MCP",
      description: "Model Context Protocol tools.",
      example: "deploy_prod({ service: 'api' })"
    },
    {
      name: "SDK",
      description: "Typed JavaScript calls.",
      example: "await acme.deploy.prod({ service: 'api' })"
    }
  ],
  groups: [
    {
      name: "deploy",
      description: "Ship applications to Acme environments.",
      commands: [
        {
          pathPrefix: "acme deploy ",
          name: "prod",
          description: "Deploy a service to production.",
          badges: ["cli", "mcp", "sdk", "approval"],
          params: [
            {
              name: "service",
              type: "string",
              requirement: "required",
              description: "Service to deploy."
            }
          ],
          secrets: [{ name: "ACME_TOKEN", description: "Acme deployment token." }],
          example: "acme deploy prod api"
        },
        {
          pathPrefix: "acme deploy ",
          name: "status",
          description: "Show the current deployment status.",
          badges: ["cli", "mcp", "sdk"],
          params: [],
          secrets: [],
          example: "acme deploy status"
        }
      ]
    }
  ],
  quickstart: "npm install -g acme\nacme deploy prod api",
  includeJs: true
};
