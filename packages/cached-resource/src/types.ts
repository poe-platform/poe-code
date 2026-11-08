export interface CachedData<T> {
  data: T;
  timestamp: number;
}

export interface FetchOptions {
  forceRefresh?: boolean;
  preferOffline?: boolean;
  offline?: boolean;
}

export interface CacheConfig {
  freshTtl: number;
  staleTtl: number;
  fetchTimeout: number;
  apiEndpoint: string;
  cacheDir: string;
  cacheName: string;
}
