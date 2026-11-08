import collections
import hashlib
import json
import subprocess

REVISION = "009c20f812926e4dc7c175b379f85753ff632691"
ROOT = "tests/commands/yq-independent-20260828/successor-review-preseal-v1"
cache = {}
checks = []


def read(revision, path):
    key = (revision, path)
    if key not in cache:
        cache[key] = subprocess.check_output(["git", "show", revision + ":" + path])
    return cache[key]


def load(name):
    return json.loads(read(REVISION, ROOT + "/" + name))


def digest(value):
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8", "backslashreplace")
    return hashlib.sha256(encoded).hexdigest()


def pointer(value, path):
    for token in path.split("/")[1:]:
        key = token.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def check(name, condition):
    checks.append({"check": name, "satisfiedAsStaticData": bool(condition)})


references = load("INPUTS.json")["entries"]
job_reference = next(row for row in references if row["role"] == "UNCHANGED_FIXTURE_JOB_DATA")
role_reference = next(row for row in references if row["role"] == "FROZEN_194_ROLES")
old_jobs = json.loads(read(job_reference["revision"], job_reference["path"]))
old_roles = json.loads(read(role_reference["revision"], role_reference["path"]))
jobs = load("JOBS.json")
rows = jobs["outerJobs"]
ledger = load("LEDGER-194.json")
obligations = load("OBLIGATIONS.json")
schedule = load("SCHEDULE.json")
types = load("TYPES.json")
loaded = load("LOADED-CONTROLS.json")
source = load("SOURCE-PROOFS.json")
admission = load("CANDIDATE-ADMISSION.json")
controls = load("CONTROLS.json")
identity_fields = ["id", "primaryRole", "secondaryRoles", "frozen", "currentOverlay", "semanticDenominatorEligible"]
check("original149CanonicalHash", digest(old_jobs["jobs"]) == jobs["frozenRuntimeJobsSha256"] == old_jobs["jobsSha256"])
check("exact194FrozenIdentitiesRoles", [[row[field] for field in identity_fields] for row in ledger["rows"]] == [[row[field] for field in identity_fields] for row in old_roles["rows"]])
check("194UniqueIDs", len(ledger["rows"]) == len({row["id"] for row in ledger["rows"]}) == 194)
role_counts = dict(collections.Counter(row["primaryRole"] for row in ledger["rows"]))
check("roleCountsUnchanged", role_counts == ledger["roleCounts"] == old_roles["roleCounts"])
check("eightOverlappingIDsUnchanged", ledger["overlays"] == old_roles["overlays"] and len(ledger["overlays"]) == 8 and set(ledger["overlays"]) <= {row["id"] for row in ledger["rows"]})
check("335UniqueDeniedSlots", len(rows) == len({row["id"] for row in rows}) == 335 and all(row["executionAuthorized"] is False and row["state"] == "UNRUN_NO_SUCCESSOR_GO" for row in rows))
check("noRecordPasses", all(row["fullRecordPass"] is False for row in ledger["rows"]))
environments = {}
for environment, phase in [("source-built-direct", "SOURCE_RUNTIME"), ("installed-moved-direct", "MOVED_RUNTIME")]:
    selected = [row for row in rows if row["phase"] == phase]
    matched = True
    for index, row in enumerate(selected):
        reference = row["frozenJobReference"]
        original = pointer(old_jobs, reference["pointer"])
        matched = matched and all(reference[field] == job_reference[field] for field in ["revision", "path"]) and reference["sha256"] == digest(original)
        matched = matched and original == old_jobs["jobs"][index] and row["environment"] == environment and row["id"] == environment + "/" + original["id"]
        matched = matched and row["recordIds"] == [original["recordId"]] and row["role"] == original["role"] and row["noSuccessInheritance"] is True and row["semanticFullRecordPass"] is False
    check(environment + "Exact149References", len(selected) == 149 and matched)
    environments[environment] = {"jobs": len(selected), "uniqueIds": len({record for row in selected for record in row["recordIds"]}), "roles": dict(collections.Counter(row["role"] for row in selected))}
check("132IDsPerEnvironment", all(value["uniqueIds"] == 132 for value in environments.values()))
semantic_rows = [row for row in ledger["rows"] if row["semanticDenominatorEligible"]]
check("94Complete17PartialEligibilityNotResults", len(semantic_rows) == 111 and sum(row["historicalCompleteProjectionEligibility"] for row in semantic_rows) == 94)
check("135MissingBindings80Records", len(obligations["missingBindings"]) == 135 and len({row["recordId"] for row in obligations["missingBindings"]}) == 80 and sum(len(row["missingBindings"]) for row in ledger["rows"]) == 135)
check("missingIDsMatchLedger", sorted(row["id"] for row in obligations["missingBindings"]) == sorted(identifier for row in ledger["rows"] for identifier in row["missingObligationIds"]))
old_by_id = {row["id"]: row for row in old_jobs["jobs"]}
values_good = True
for row in obligations["obligations"]:
    value = pointer(old_by_id[row["jobId"]], row["expectedPointer"])
    values_good = values_good and value == row["declaredValue"] and digest(value) == row["declaredValueSha256"] and row["implementationBinding"] is None and row["fullRecordPass"] is False
check("371UnboundDeclaredValuesMatchFrozenPointers", len(obligations["obligations"]) == len({row["id"] for row in obligations["obligations"]}) == 371 and values_good)
check("allExpectedTopLevelFieldsRepresented", {(job["id"], key) for job in old_jobs["jobs"] for key in job["expected"]} == {(row["jobId"], row["expectedPointer"].split("/")[2]) for row in obligations["obligations"]})
check("old31RawFailsPreserved", len(obligations["historicalUnfulfilled"]) == 31 and all(row["rawAggregate"] == "FAIL" for row in obligations["historicalUnfulfilled"]))
phases = []
cumulative = 0
for phase in schedule["phases"]:
    selected = [row for row in rows if row["phase"] == phase["id"]]
    total = sum(row["slotCapMs"] for row in selected)
    check(phase["id"] + "MembershipAndSum", phase["jobIds"] == [row["id"] for row in selected] and total == phase["capMs"])
    check(phase["id"] + "AbsoluteCutoff", phase["startOffsetMs"] == cumulative and phase["absoluteCutoffOffsetMs"] == cumulative + phase["capMs"] and all(row["phaseAbsoluteCutoffOffsetMs"] == phase["absoluteCutoffOffsetMs"] for row in selected))
    phases.append({"id": phase["id"], "outerSlots": len(selected), "sumSlotCapsMs": total, "startOffsetMs": cumulative, "absoluteCutoffOffsetMs": phase["absoluteCutoffOffsetMs"], "allocation": phase["allocation"]})
    cumulative += phase["capMs"]
check("global23625000EqualsEverySlotAndPhase", cumulative == 23625000 == schedule["globalMonotonicCapMs"] == sum(row["slotCapMs"] for row in rows))
check("12CompilerDescendantsBuild1Direct6Public5", sum(row.get("maxCompilerDescendants", 0) for row in rows) == 12 == schedule["maxCompilerDescendants"])
for phase_id in ["SOURCE_RUNTIME", "MOVED_RUNTIME", "LOADED_CONTROLS"]:
    allocation = next(phase["allocation"] for phase in phases if phase["id"] == phase_id)
    check(phase_id + "SuballocationsWith5000Cleanup", sum(allocation["perRecord"].values()) == allocation["recordSlotMs"] and allocation["perRecord"]["cleanupKnownReap"] == 5000)
allocation = next(phase["allocation"] for phase in phases if phase["id"] == "TYPES")
for name, worker in [("direct", "directWorker"), ("public", "conditionalPublicWorker")]:
    details = allocation[name]
    check("TYPE_" + name + "Suballocations", details["setup"] + details["compilerInvocations"] * details["compilerMsEach"] + details["postguardsEvidence"] + details["cleanup"] == allocation[worker])
check("18Guards31CMD22DefinitionsOneWorker", len(controls["controls"]) == 18 and controls["cmd22"]["count"] == 31 and len([row for row in rows if row["id"] == "CONTROL-CMD22-31"]) == 1)
check("tenLoadedSlotsFourWitnessesPerEnvironment", len([row for row in rows if row["phase"] == "LOADED_CONTROLS"]) == 10 and len(loaded["mutants"]) == 4 and all(row["witness"] in old_by_id for row in loaded["mutants"]))
check("mutantsExplicitlyUnbound", all(all(row[field] is None for field in ["preimageHash", "patchHash", "postimageHash", "mutantPackageManifest"]) and row["authorization"]["state"] == "UNBOUND_DENY" for row in loaded["mutants"]))
check("sixDirectFivePublicGapDefinitions", len([row for row in types["fixtures"] if row["mode"] != "PUBLIC_ONLY"]) == 6 and len([row for row in types["fixtures"] if row["mode"] == "PUBLIC_ONLY"]) == 5)
check("23PrimarySourceTwoOverlappingAnnotations", len(source["designated"]) == 23 and {row["id"] for row in source["designated"]} == {row["id"] for row in ledger["rows"] if row["primaryRole"] == "source-static-counterproof"} and len(source["secondaryAnnotations"]) == 2)
check("allCandidateSlotsNullDeny", admission["execute"] is False and admission["rootGO"]["value"] is None and all(value["value"] is None and value["state"] == "UNBOUND_DENY" for value in admission["slots"].values()))
check("noRetrySingleOuterWorker", schedule["retryAllowance"] == 0 and schedule["maximumConcurrentOuterWorkers"] == 1)
check("gitHelperCeilingArithmetic", schedule["metadataToolBounds"]["globalMaximumGitHelpers"] == 335 * 32768 == 10977280)
known_storage = 179 * 67108864 + 335 * 16777216 + 12 * 8388608
result = {
    "classification": "INDEPENDENT_STATIC_DATA_ARITHMETIC_NOT_RUNTIME",
    "evidenceCommit": REVISION,
    "checks": checks,
    "staticChecksSatisfied": sum(row["satisfiedAsStaticData"] for row in checks),
    "staticChecksUnsatisfied": [row["check"] for row in checks if not row["satisfiedAsStaticData"]],
    "notAcceptance": "SS-F01 and pending implementation/bindings are not resolved by data consistency.",
    "roles": role_counts,
    "environments": environments,
    "environmentCount": 2,
    "installedAndMovedAreOneProfile": True,
    "obligationStateCounts": dict(collections.Counter(row["state"] for row in obligations["obligations"])),
    "gapRecords": 80,
    "missingBindings": 135,
    "historicalIncomplete": 31,
    "overlayRouting": [{"id": row["id"], "jobs": row["successorJobs"], "missingBindings": row["missingObligationIds"]} for row in ledger["rows"] if row["id"] in ledger["overlays"]],
    "phases": phases,
    "globalCapMs": cumulative,
    "duration": {"hours": cumulative // 3600000, "minutes": cumulative % 3600000 // 60000, "seconds": cumulative % 60000 // 1000},
    "maxOuterSlots": len(rows),
    "maxCompilerDescendants": sum(row.get("maxCompilerDescendants", 0) for row in rows),
    "candidateNullSlots": len(admission["slots"]),
    "cleanupQualification": "Runtime/loaded slots include 1000+4000=5000ms. Generic control/setup and nested compiler ownership still require implemented internal reserves; no external grace, reset or guaranteed reap is inferred.",
    "headroomVsHistoricalMovedWholeMax": {"historicalMs": 27231, "sourceSlotMs": 45000, "sourceDifferenceMs": 17769, "sourceRatio": 45000 / 27231, "movedSlotMs": 90000, "movedDifferenceMs": 62769, "movedRatio": 90000 / 27231, "qualification": "Finite headroom, not measured phase isolation, a forecast/guarantee, native benchmark or product-bug attribution."},
    "storageArithmetic": {"knownPackageAndCaptureReservationsBytes": known_storage, "cohortCeilingBytes": 25769803776, "remainingBaseSourceToolAllowanceBytes": 25769803776 - known_storage, "qualification": "Aggregate arithmetic only. Exact tool and copy reservations remain unimplemented."},
    "execution": {"authoredValidators": 0, "controls": 0, "predicates": 0, "adapters": 0, "materializers": 0, "loaders": 0, "product": 0, "builds": 0, "compilers": 0, "harnessCohorts": 0},
    "controlPasses": 0,
    "runtimePasses": 0,
    "productPasses": 0
}
text = json.dumps(result, indent=2) + "\n"
print(text, end="")
if result["staticChecksUnsatisfied"]:
    raise SystemExit(1)
