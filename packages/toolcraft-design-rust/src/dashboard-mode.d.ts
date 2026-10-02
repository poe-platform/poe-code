type DashboardIo = {
  stdin: {isTTY?: boolean | undefined};
  stdout: {isTTY?: boolean | undefined};
};
export declare function shouldUseInteractiveDashboard(
  enabled: boolean | undefined,
  io?: DashboardIo
): boolean;
export {};
