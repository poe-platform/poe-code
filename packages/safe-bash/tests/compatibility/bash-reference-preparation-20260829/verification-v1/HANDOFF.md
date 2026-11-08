# Verifier preparation checkpoint — August29,2026

**Preparation evidence, not16-pair signature acceptance.** No archive extraction,
patch application, build, downloaded-code execution, local Bash repeat, private
keyring/config access, agent/keyserver invocation or old-held-track execution.
Acquisition822e82a70dfebc071d3b6e27bc78967afa40a993 remains immutable.

## Actual metadata work

- Three pinned Apple CLT llvm-otool children inspected `-L`/`-l` metadata. They
  closed successfully. Eight external identities cover gpgv, gpg and six external
  dylibs, including resolved opt→Cellar aliases; pre/post SHA256/mode/size checks
  passed. No unresolved external load name was observed in this bounded graph.
- The static graph identifies eight OS library/framework names. The platform is
  bound to SystemVersion.plist (macOS26.4.1/build25E253), dyld SHA256
  `a572fe3d9d46fc2c6461745a13940ec63de8c9ab333fcba5ef1e112783e521a7`,
  and15 public system-cache files totaling5792334959bytes. Cache bytes were only
  streamhashed, never copied/decoded/extracted; these reads are not working-space
  allocation or a performance/RSS benchmark.
- One installed pinned gpg child inspected the publisher's public key with
  `--show-keys`, `--no-options`, `--no-keyring`, `--no-autostart`, disabled automatic
  key lookup/import and owned HOME/GNUPGHOME/TMPDIR/empty PATH. Exact flags,
  environment, raw output and close event are in KEY-INSPECTION-01. No key import,
  dearmor or gpgv call occurred. All25 input/tool/platform identities were checked
  before and after. Actual DYLD image diagnostics accompany the static bindings;
  this is **not** an independently proved OS fence or a cache-image extraction.

## Publisher attribution, not guessed issuer trust

Seven finite official followup requests were presealed. Current documented
`/p/release-gpgkeys.php?group=bash` and its download variant both returned404;
preserve them separately from the old `/project/`404 and GNU text timeouts.
Five other official responses succeeded: keyring guidance, Bash project page,
UsingGpg guidance, Chet's profile and its exact linked public-key response.

The captured GNU project page names Chet Ramey as Bash group admin and links
`https://savannah.gnu.org/users/chet`. That profile (SHA256
`56b89c2bfb00f86ca518661d5addd5e3d0d1f7bfe14060be3e610d9035eab177`)
links `https://savannah.gnu.org/people/viewgpg.php?user_id=2590`.
That response is2200bytes/application/pgp-keys, SHA256
`db4041b4d3896b9f21250e6c29861958bd5d4781f521f06beda849a9ed79fae8`.
The linked public-key fingerprint/UID observations are recorded byte-exact in
KEY-INSPECTION-01/stdout.raw and summarized in OBSERVATIONS.json. They came from
independently acquired publisher material, **not** from trusting a detached
signature's self-reported issuer.

This establishes attributable maintainer public-key material, not a claim that
the inaccessible project release-key registry approved a particular key for
every patch. The sixteen signatures have not yet been tested against it; signer
coverage, signature validity, and any additional/newer signing key remain unknown.
Do not infer that the historical maintainer key covers all2026patches. GNU's
global keyring remains acquired but uninspected here. gpgv's documented trust of
all supplied keyring keys makes publisher authorization a separate requirement;
its raw success must not be relabeled universal revocation/expiry verification.

## Why16pairs remain UNRUN

The fresh48ALL-process cap includes administrative shells/Git/edit/read tools,
not just the eventual verifier children. The declared dispatch ledger through
publication accounts for47process roles (six Node controllers, four supervised
native metadata children,37administrative command/launcher roles). This is a
conservative dispatch accounting, **not kernel-level descendant telemetry**.
Sixteen gpgv children plus keyring preparation, integrity checks and publication
cannot fit the remaining reservation. No deadline/child quota was renewed or
hidden, no different crypto protocol substituted to combine the16jobs, and no
partial signature result is promoted into acceptance.

The concrete remaining task is a fresh presealed execution cohort, not another
Bash/version probe or redownload. After ROOT reviews the static/platform
qualification and attributable key material, bind exact owned keyring bytes
(trusted offline dearmor if needed), hash all existing16payload+signature pairs
before/after, and run literal gpgv `--homedir OWNED --keyring OWNED_KEYRING
--status-fd 1 SIG PAYLOAD` for each. Empty owned configuration and no network,
agent/private/default keyring; record full raw status/fingerprint/exit/cleanup.
Accept only signatures whose actual full signer identity has publisher authority;
an absent or newly observed signer is unresolved, not permission to trust the
entire global keyring indiscriminately or weaken algorithms.

Suggested separate cohort ceiling:10min/32ALLstarts/peak3/16MiBcapture/64MiBnew
working, existing artifacts read-only,16verification children plus at most two
trusted key-material metadata/conversion children and14controller/admin roles.
Prepare exact executor/argv/keyring seal before dispatch; no build grant implied.

## Relay / retained limits

For Faraday: already captured local binary reports GNU Bash3.2.57(1)-release,
arm64-apple-darwin25, exit0,109stdout bytes/0stderr; it is not GNU5.3 nor provider
qualification. No repeat occurred in this grant.

All four native metadata children closed and all controllers returned. Owned
homes/captures are retained; no active sessions, old archive cleanup or global
changes. Source/data seal and loaded-image qualifications are in SEAL.json and
OBSERVATIONS.json. Old failures remain unchanged. Signature verification,
5.3 executable admission, provider fence and40native cases remain UNRUN.
