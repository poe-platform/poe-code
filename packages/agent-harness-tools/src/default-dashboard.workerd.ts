import type { Dashboard, DashboardOptions } from "toolcraft-design";
export function createDashboard(_options: DashboardOptions): Dashboard {
  throw new Error("Provide dashboardFactory to render a harness dashboard in this runtime.");
}
