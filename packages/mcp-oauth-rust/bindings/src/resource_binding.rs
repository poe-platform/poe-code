use super::convert::NativeJson;
use mcp_oauth_rust::resource_credentials::ResourceCredentials;
use mcp_protocol_rust::json;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi]
pub struct NativeResourceCredentials {
    state: ResourceCredentials,
}
#[napi]
impl NativeResourceCredentials {
    #[napi(constructor)]
    pub fn new(source: Option<String>) -> Result<Self> {
        ResourceCredentials::read(source.as_ref().map(|source| source.as_bytes()))
            .map(|state| Self { state })
            .map_err(napi::Error::from_reason)
    }
    #[napi(getter)]
    pub fn resource(&self) -> Option<Utf16String> {
        self.state.resource().map(|value| value.to_vec().into())
    }
    #[napi(getter)]
    pub fn issuers(&self) -> NativeJson {
        NativeJson(self.state.issuers())
    }
    #[napi(getter)]
    pub fn initial_grant_allowed(&self) -> bool {
        self.state.initial_grant_allowed()
    }
    #[napi]
    pub fn reconcile(&mut self, resource: Utf16String) -> Result<bool> {
        self.state
            .reconcile(&resource)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn session(&self, resource: Utf16String) -> NativeJson {
        NativeJson(self.state.session(&resource))
    }
    #[napi]
    pub fn client(&self, issuer: Utf16String) -> NativeJson {
        NativeJson(self.state.client(&issuer))
    }
    #[napi]
    pub fn set_session(&mut self, session: Utf16String) -> Result<()> {
        let value = json::parse_utf16(&session, Default::default())
            .map_err(|_| napi::Error::from_reason("Invalid OAuth session JSON"))?;
        self.state
            .set_session(value)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn clear_session(&mut self) -> Result<()> {
        self.state.clear_session().map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn set_client(&mut self, issuer: Utf16String, client: Utf16String) -> Result<()> {
        let value = json::parse_utf16(&client, Default::default())
            .map_err(|_| napi::Error::from_reason("Invalid OAuth client JSON"))?;
        self.state
            .set_client(issuer.to_vec(), value)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn clear_client(&mut self, issuer: Utf16String) -> bool {
        self.state.clear_client(&issuer)
    }
    #[napi]
    pub fn serialize(&self) -> Result<String> {
        self.state.serialize().map_err(napi::Error::from_reason)
    }
    #[napi(factory)]
    pub fn reset(resource: Utf16String) -> Self {
        Self {
            state: ResourceCredentials::reset(resource.to_vec()),
        }
    }
    #[napi(factory)]
    pub fn import_session(env: Env, source: Unknown<'_>) -> Result<Self> {
        let value = super::registration_binding::read_credential_json(env, source)
            .map_err(|_| napi::Error::from_reason("Invalid OAuth import session"))?;
        ResourceCredentials::import_session(value)
            .map(|state| Self { state })
            .map_err(napi::Error::from_reason)
    }
    #[napi(getter)]
    pub fn import_bindings(&self) -> Result<NativeJson> {
        self.state
            .import_bindings()
            .map(NativeJson)
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn canonicalize_import(&mut self, resource: Utf16String) -> Result<()> {
        self.state
            .canonicalize_import(resource.to_vec())
            .map_err(napi::Error::from_reason)
    }
}
