export type SnapshotMode = 'playback' | 'record';
export type SnapshotMissBehavior = 'error' | 'warn' | 'passthrough' | 'record';

export interface ProxyRoute {
  path: string;
  target: string;
  mode: SnapshotMode;
  snapshotDir?: string;
}

export interface ProxyConfig {
  port: number;
  routes: ProxyRoute[];
  captureFile: string;
  onMiss: SnapshotMissBehavior;
}

export interface CapturedExchange {
  timestamp: string;
  route: string;
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    body: unknown;
  };
}
