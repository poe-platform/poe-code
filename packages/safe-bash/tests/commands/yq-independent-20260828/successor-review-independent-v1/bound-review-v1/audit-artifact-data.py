import hashlib
import io
import json
import posixpath
import subprocess
import tarfile

DATA_REVISION = "e729a5ab8776ea768d10e6107692149989b2511d"
DATA_ROOT = "tests/commands/yq-independent-20260828/candidate-b8f5d60d-preseal-v2"
BASELINE = "5137a74ec855a32d8a8860eb66b62eb44d11e290"
INTERPRETER = "74361026502d76b8c2b696f9c60e410ac9b78d95"
CANDIDATE = "b8f5d60d75452e1dd181167fb87abd995221f6e3"
EVIDENCE = "644460b932feb6fa87222b7042d705da1219cf0c"
ARCHIVE_HASH = "fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878"
PACKAGE_HASH = "1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca"
trees = {}


def git(*arguments):
    return subprocess.check_output(["git", *arguments])


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_hash(value):
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())


def data(name):
    return json.loads(git("show", DATA_REVISION + ":" + DATA_ROOT + "/" + name))


def reference_json(reference):
    raw = git("show", reference["revision"] + ":" + reference["path"])
    assert sha(raw) == reference["sha256"]
    return json.loads(raw)


def tree(revision):
    if revision not in trees:
        entries = {}
        for row in git("ls-tree", "-r", "-z", revision).split(b"\0"):
            if row:
                metadata, path = row.decode().split("\t", 1)
                mode, kind, blob = metadata.split()
                entries[path] = {"mode": mode, "kind": kind, "blob": blob}
        trees[revision] = entries
    return trees[revision]


def parse_archive(raw, prefix):
    files = {}
    payloads = {}
    names = []
    total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:*") as archive:
        for member in archive:
            assert len(files) < 4096 and member.isfile() and not member.issym() and not member.islnk()
            assert member.name.startswith(prefix)
            name = member.name[len(prefix):]
            assert name and not name.startswith("/") and posixpath.normpath(name) == name and ".." not in name.split("/") and name not in files
            assert member.size <= 16777216
            content = archive.extractfile(member).read(16777217)
            assert len(content) == member.size
            total += len(content)
            assert total <= 67108864
            files[name] = {"sha256": sha(content), "bytes": len(content), "mode": member.mode}
            payloads[name] = content
            names.append(name)
    return files, payloads, names


composition = data("COMPOSITION.json")
authority = data("SOURCE-AUTHORITY.proposed.json")
source_receipt = data("SOURCE-RECEIPT.proposed.json")
full_receipt = data("FULL-RECEIPT.proposed.json")
archive_raw = git("show", EVIDENCE + ":" + authority["archive"]["path"])
package_raw = git("show", EVIDENCE + ":" + authority["package"]["path"])
assert len(archive_raw) <= 67108864 and len(package_raw) <= 67108864
assert sha(archive_raw) == ARCHIVE_HASH and sha(package_raw) == PACKAGE_HASH
archive, archive_bytes, archive_order = parse_archive(archive_raw, "")
package, package_bytes, package_order = parse_archive(package_raw, "package/")
source_base = reference_json(composition["sourceBase"])
package_base = reference_json(composition["baselinePackage"])
old_maps = reference_json(composition["previousCompleteMaps"])
manifest_raw = git("show", EVIDENCE + ":" + authority["manifest"]["path"])
assert sha(manifest_raw) == authority["manifest"]["sha256"]
manifest = json.loads(manifest_raw)
manifest_by_path = {row["path"]: row for row in manifest["files"]}
assert len(manifest_by_path) == len(manifest["files"]) == 281
excluded = {row["path"]: row for row in composition["excludedAuthorSelections"]}
assert len(excluded) == 8 and set(manifest_by_path) - set(excluded) == set(archive)
assert all(name.startswith("tests/") for name in excluded)
assert not any(name.startswith("tests/") for name in archive)
additions = source_receipt["sourceAdditions"]
assert len(additions) == 7 and set(additions) == {row["path"] for row in authority["newSources"]}
assert all(name.startswith("src/commands/yq/") or name == "src/commands/structured/query-core.ts" for name in additions)
source = {name: {key: entry[key] for key in ["sha256", "bytes", "mode"]} for name, entry in source_base.items()}
source.update(additions)
assert len(source_base) == 264 and len(source) == 271 and len(archive) == 273
assert set(archive) - set(source) == {"package-lock.json", "scripts/typecheck.mjs"}
origins = {}
for name, descriptor in archive.items():
    revision = CANDIDATE if name in additions else INTERPRETER if name == "src/commands/structured/interpreter.ts" else BASELINE
    selected = tree(revision)[name]
    content = archive_bytes[name]
    blob = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
    assert selected == {"mode": "100644", "kind": "blob", "blob": blob}
    manifest_entry = manifest_by_path[name]
    assert manifest_entry["blob"] == blob and manifest_entry["mode"] == "100644"
    assert descriptor == {"sha256": manifest_entry["sha256"], "bytes": manifest_entry["bytes"], "mode": 420}
    if name in source:
        assert source[name] == descriptor
    if name in source_base:
        assert source_base[name]["revision"] == revision and source_base[name]["blob"] == blob
    origins[name] = revision
assert len(package_base) == 846 and len(full_receipt["packageAdditions"]) == 24
assert not set(package_base) & set(full_receipt["packageAdditions"])
assert package == {**package_base, **full_receipt["packageAdditions"]} and len(package) == 870
directories = {"": 493}
for name in package:
    parent = posixpath.dirname(name)
    while parent:
        directories[parent] = 493
        parent = posixpath.dirname(parent)
assert directories == full_receipt["packageDirectories"] == composition["package"]["directories"]
source_hash = canonical_hash(source)
package_hash = canonical_hash({"files": package, "directories": directories})
assert source_hash == "9b0e0d62ea50eea55ef9ff4bff9e4bcef9cba6b73e416793bee6956666171002"
assert package_hash == "aef2daaca66d3e18487903b79693fbf6a5126b0fda481f1e96ed4e33e08db321"
assert set(source) == set(old_maps["source"]["files"]) and set(package) == set(old_maps["fullPackage"]["files"])
source_delta = sorted(name for name in source if source[name] != old_maps["source"]["files"][name])
output_delta = sorted(name for name in package if package[name] != old_maps["fullPackage"]["files"][name])
assert len(source_delta) == 5 and source_delta == sorted(row["path"] for row in composition["sourceDelta"])
assert len(output_delta) == 17 and output_delta == sorted(row["path"] for row in composition["package"]["changes"])
assert package["README.md"] == source["README.md"] == package_base["README.md"]
whole_data = data("GIT-IDENTITIES.json")
whole = {name: entry for name, entry in tree(CANDIDATE).items() if any(name == scope or name.startswith(scope + "/") for scope in whole_data["scope"])}
extras = sorted(set(whole) - set(source))
changed = sorted(name for name in source if whole[name]["blob"] != tree(origins[name])[name]["blob"])
assert len(whole) == 301 and len(extras) == 30 and len(changed) == 8
assert extras == sorted(row["path"] for row in whole_data["extraPaths"])
assert changed == sorted(row["path"] for row in whole_data["changedSelectedPaths"])
result = {
    "classification": "INDEPENDENT_READ_ONLY_ARTIFACT_DATA_AUTHENTICATION_NOT_COMPILATION",
    "candidateSource": CANDIDATE,
    "candidateEvidence": EVIDENCE,
    "packetEvidence": DATA_REVISION,
    "rawBothRootHashesCheckedBeforeParsing": True,
    "archiveSha256": sha(archive_raw),
    "archiveBytes": len(archive_raw),
    "packageSha256": sha(package_raw),
    "packageBytes": len(package_raw),
    "source271MapSha256": source_hash,
    "package870MapSha256": package_hash,
    "counts": {"manifest": 281, "excludedTestData": 8, "archive": 273, "sourceProjection": 271, "baselineSource": 264, "newSourceFiles": 7, "package": 870, "baselinePackage": 846, "newOutputFiles": 24, "changedSourceFiles": 5, "changedOutputFiles": 17, "wholeGitProductScope": 301, "unselectedWholeGitExtras": 30, "unselectedWholeGitBaselineChanges": 8},
    "sourceDelta": source_delta,
    "outputDelta": output_delta,
    "wholeGitChangedSelectedPaths": changed,
    "wholeGitExtraPaths": extras,
    "excludedAuthorTestPaths": sorted(excluded),
    "sourcePolicy": "Exact baseline5137 plus interpreter7436 plus seven authorized b8 YQ/query-core files; not whole candidate tree",
    "archiveOnlySupportFiles": ["package-lock.json", "scripts/typecheck.mjs"],
    "readme": package["README.md"],
    "sourceBaseReference": composition["sourceBase"],
    "baselinePackageReference": composition["baselinePackage"],
    "previousMapsReference": composition["previousCompleteMaps"],
    "regularArchiveEntriesOnly": True,
    "physicalMaterializationOrMoveProved": False,
    "directoryModes": "0755 proposed materialization map; tar has no directory entries",
    "independentCompile": False,
    "newSemanticAcceptance": False,
    "productBuildTypeLoaderControlExecutions": 0,
    "freshGO": False
}
print(json.dumps(result, indent=2))
