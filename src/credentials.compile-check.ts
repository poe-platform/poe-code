import type {
  FetchPoeAuthIdentityOptions,
  GetPoeAuthIdentityOptions,
  PoeAuthIdentity
} from "./credentials.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredFetchOptionsArePublic = AssertAssignable<
  FetchPoeAuthIdentityOptions,
  { apiKey: string }
>;
type ignoredGetOptionsArePublic = AssertAssignable<
  GetPoeAuthIdentityOptions,
  { apiKey?: string }
>;
type ignoredIdentityIsPublic = AssertAssignable<
  PoeAuthIdentity,
  { user_id: number; handle: string; name: string; profile_picture: string }
>;
