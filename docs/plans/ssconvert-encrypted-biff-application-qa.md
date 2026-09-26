# Encrypted BIFF source investigation and application qualification

Keep the encrypted-BIFF family open until its remaining profiles, ancillary streams,
application/platform checks and publication obligations have completion evidence.
This procedure supplements the existing Gnumeric and independent cipher results.
Follow the user's source-first direction: investigate existing captures against the
exact LibreOffice build source before adding application runs or test matrices.

Current evidence: `../ssconvert/biff-libreoffice-interop-proof.json`. The 35-profile
capture is complete; six files opened. Source explains the password/key-size
refusals and the native XLSX error rewrite. No product repair is established by
these findings. Screenshot qualification and native reopening of the reexports
remain unresolved; the failed UI attempts are not passes.

1. Pin source to the native build revision and trace each observed discrepancy
   through import, internal representation and export. Record immutable URLs,
   hashes, function names and line references. Keep native limitations distinct
   from the product's independently established format support.
2. Reduce the existing captures to hashes, counts and explicit limitations. The
   25-unit incorrect-password probes exceed Calc's admitted length and establish
   refusal only, not verifier rejection of an admitted-length incorrect password.
3. Commit concise evidence and update the canonical gap ledger. Remove owned
   processes, mounted images, downloads, generated workbooks and temporary source
   copies after reduction. Keep the broad family open.

Deferred application procedure (only when a remaining question needs execution):

1. Authenticate the retained LibreOffice 26.8.0.3 macOS arm64 image against
   `odf-libreoffice-interop-proof.json` before executing it. Mount read-only and use
   an isolated profile under `out/ssconvert-biff-libreoffice`. Record executable,
   library and Java bridge identities. Disable macros and external-link updates;
   decline interaction requests. Use only original owned workbooks and passwords.
2. Export the same two-sheet workbook through the compiled public ssconvert SDK:
   plaintext control, standard RC4 passwords at 0/1/15/16/27/28/31/32/255 UTF-16
   units and a non-BMP Unicode password, and CryptoAPI key sizes 40 through 128
   in eight-bit steps with ASCII and Unicode passwords. Include long strings that
   cross BIFF CONTINUE and encryption block boundaries, numeric/boolean/error
   values and formulas with independently known results. Record complete input
   hashes and SDK reopen results; never count missing cases as passes.
3. Load each original export through LibreOffice's actual Calc loader with its
   explicit password. Compare both sheets' complete expected cells before and
   after native recalculation. Capture every refusal or diagnostic separately.
   Repeat each encrypted profile with an incorrect password and require refusal.
   Do not classify a native refusal as a product defect without independent
   format evidence, or change supported product limits to match native limits.
4. Reopen applicable native plaintext BIFF/XLSX reexports through the public SDK
   and Shell. Preserve source bytes, compare native and candidate values, and
   inspect one representative application screenshot when UI access works. If a mismatch is found,
   reproduce it with a small memory test before editing implementation.
5. Reduce results to concise hashes, runtime identities and findings in the
   existing gap ledger or a focused proof. Commit atomic repairs and evidence,
   verify remote main and monitor containing publication. Close owned native
   components/processes, detach the image, and purge all temporary files. Keep
   unresolved profiles and broader family obligations explicit.
