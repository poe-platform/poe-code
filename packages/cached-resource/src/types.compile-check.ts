import type { CachedData, FetchOptions, CacheConfig } from "./types.js";
import type {
  CachedData as CachedDataFromIndex,
  FetchOptions as FetchOptionsFromIndex,
  CacheConfig as CacheConfigFromIndex,
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

// Verify types are re-exported from index
type ignoredCachedDataExported = AssertAssignable<CachedData<unknown>, CachedDataFromIndex<unknown>>;
type ignoredCachedDataMatches = AssertAssignable<CachedDataFromIndex<unknown>, CachedData<unknown>>;
type ignoredFetchOptionsExported = AssertAssignable<FetchOptions, FetchOptionsFromIndex>;
type ignoredFetchOptionsMatches = AssertAssignable<FetchOptionsFromIndex, FetchOptions>;
type ignoredCacheConfigExported = AssertAssignable<CacheConfig, CacheConfigFromIndex>;
type ignoredCacheConfigMatches = AssertAssignable<CacheConfigFromIndex, CacheConfig>;

// Verify CachedData shape
type ignoredCachedDataShape = AssertAssignable<
  CachedData<string>,
  { data: string; timestamp: number }
>;

// Verify CachedData is generic
type ignoredCachedDataGenericArray = AssertAssignable<
  CachedData<string[]>,
  { data: string[]; timestamp: number }
>;

// Verify FetchOptions fields are optional
type ignoredFetchOptionsFull = AssertAssignable<
  FetchOptions,
  { forceRefresh: boolean; preferOffline: boolean; offline: boolean }
>;

// Verify CacheConfig shape
type ignoredCacheConfigShape = AssertAssignable<
  CacheConfig,
  {
    freshTtl: number;
    staleTtl: number;
    fetchTimeout: number;
    apiEndpoint: string;
    cacheDir: string;
    cacheName: string;
  }
>;
