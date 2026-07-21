# Release attestation contract

## Status

Schema version 3 is implemented by `scripts/release-attestation.mjs`. The local annotated `v1.0.0-rc.2` product tag now points to `2b4069538c242da37c8c43d6581e097149fa1994`, tag object `19d9fd992bac6e3e356a7ff871fea966dbfb456b`. The current evidence branch contains a format-2 manifest, manifest-bound production/offline smoke, headed local performance, and full 30-minute headed Rival soak for that product tag, as recorded in `QA_REPORT.md` and `LAUNCH_READINESS.md`. All 71 release-attestation fixtures pass within the 452-check `npm test` command: 302 Vitest, 45 release-manifest, 71 release-attestation, and 34 production-smoke/service-worker/release-scope checks.

The final schema-v3 attestation remains incomplete. Seven of the ten mandatory structured QA records now exist and are bound to the tagged product manifest aggregate: `typecheck` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/typecheck.json` (SHA-256 `46d74779433f5a3a8c5fc9a8eff0e15b7592cb6786d4f6e3b0fe0e2b72108004`), `lint` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/lint.json` (SHA-256 `5d3d8f621f31a37c95a8cf4e9c8eba6ddb0d6559aa205fbc5e0db47953cfa39f`), `assets` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/assets.json` (SHA-256 `cbb1ded261f496014ad7baac46c4d292be21303001101375447dff00f69889d4`), `dependencyAudit` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/dependencyAudit.json` (SHA-256 `2a510c012cc81b1ebb15f4d3aebaeb962d16731cfbff5a38458612a4195c2d27`), `unit` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/unit.json` (SHA-256 `b605356afe24f0ff3b422eca5498bce8819b0db70ef44ba69a0f61ae8502cbb9`), `persistence` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/persistence.json` (SHA-256 `3e7a8cc1287c4858f9bbd1f7ba38d64a97dd60292dec2ad9929d154575ec7fa8`), and `reliability` at `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/reliability.json` (SHA-256 `712dc787e46329f8b3a4038b1f8bbd91b64bc79b825cd1543599620e88548f6b`). Their command logs live under `artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/logs/` with exact file-reference hashes embedded in each record. The remaining three structured QA records/logs (`browser`, `accessibility`, and `visual`), owner/authenticated visual approval and promoted baseline, accessibility and legal approvals, source-bound predecessor rollback archive/retrieval/smoke/data-safety records, `artifacts/release-attestations/v1.0.0-rc.2.json`, and annotated `attestation/v1.0.0-rc.2` tag are still missing.

The corrected production-length visual harness passes all production-asset readiness prerequisites, and a controlled visual candidate/capture path has passed technical capture. No owner-approved Canyon baseline has been promoted. Passing Canyon structural/runtime checks, technical visual captures, production smoke, performance, and soak still do not satisfy this contract's exact-product visual approval, rollback, final-report READY markers, or human-approval requirements.

This verifier is an evidence-only final gate. It does not build the game, launch a browser, create evidence, infer a human decision, or turn an unverified record into an approval.

## Version 3 attestation record

The JSON root has exactly these fields; unknown or missing fields fail validation:

```json
{
  "schemaVersion": 3,
  "kind": "release-attestation",
  "product": "RIVET RIDGE RALLY",
  "version": "1.0.0-rc.2",
  "createdAt": "2026-07-16T13:00:00.000Z",
  "productRelease": {
    "tag": "v1.0.0-rc.2",
    "commit": "<product-commit>",
    "tagObject": "<annotated-product-tag-object>",
    "manifest": {
      "path": "artifacts/history/release-manifest-1.0.0-rc.2-format-2.json",
      "bytes": 1,
      "sha256": "<manifest-file-sha256>",
      "aggregateSha256": "<manifest-dist-aggregate-sha256>"
    }
  },
  "evidence": {
    "headedPerformance": {
      "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/performance/headed-measurement.json",
      "bytes": 1,
      "sha256": "<sha256>"
    },
    "soak": {
      "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/performance/30m-soak.json",
      "bytes": 1,
      "sha256": "<sha256>"
    },
    "productionSmoke": {
      "path": "artifacts/production-smoke/candidates/<manifest-file-sha256>/runs/<run-id>/chrome-smoke.json",
      "bytes": 1,
      "sha256": "<sha256>"
    },
    "qaChecks": {
      "accessibility": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/accessibility.json", "bytes": 1, "sha256": "<sha256>" },
      "assets": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/assets.json", "bytes": 1, "sha256": "<sha256>" },
      "browser": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/browser.json", "bytes": 1, "sha256": "<sha256>" },
      "dependencyAudit": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/dependencyAudit.json", "bytes": 1, "sha256": "<sha256>" },
      "lint": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/lint.json", "bytes": 1, "sha256": "<sha256>" },
      "persistence": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/persistence.json", "bytes": 1, "sha256": "<sha256>" },
      "reliability": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/reliability.json", "bytes": 1, "sha256": "<sha256>" },
      "typecheck": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/typecheck.json", "bytes": 1, "sha256": "<sha256>" },
      "unit": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/unit.json", "bytes": 1, "sha256": "<sha256>" },
      "visual": { "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/qa/visual.json", "bytes": 1, "sha256": "<sha256>" }
    }
  },
  "approvals": {
    "qa": {
      "status": "APPROVED",
      "role": "qa",
      "scope": "release-qualification",
      "productTag": "v1.0.0-rc.2",
      "productCommit": "<product-commit>",
      "manifestAggregateSha256": "<manifest-dist-aggregate-sha256>",
      "approvedBy": "<accountable person>",
      "approvedAt": "<canonical UTC timestamp>",
      "evidence": {
        "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/approvals/qa.json",
        "bytes": 1,
        "sha256": "<sha256>"
      }
    },
    "accessibility": {
      "status": "APPROVED",
      "role": "accessibility",
      "scope": "release-accessibility",
      "productTag": "v1.0.0-rc.2",
      "productCommit": "<product-commit>",
      "manifestAggregateSha256": "<manifest-dist-aggregate-sha256>",
      "approvedBy": "<accountable person>",
      "approvedAt": "<canonical UTC timestamp>",
      "evidence": {
        "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/approvals/accessibility.json",
        "bytes": 1,
        "sha256": "<sha256>"
      }
    },
    "legal": {
      "status": "APPROVED",
      "role": "legal",
      "scope": "release-rights-privacy-and-trade-dress",
      "productTag": "v1.0.0-rc.2",
      "productCommit": "<product-commit>",
      "manifestAggregateSha256": "<manifest-dist-aggregate-sha256>",
      "approvedBy": "<accountable person>",
      "approvedAt": "<canonical UTC timestamp>",
      "evidence": {
        "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/approvals/legal.json",
        "bytes": 1,
        "sha256": "<sha256>"
      }
    }
  },
  "rollback": {
    "status": "VERIFIED",
    "releaseTag": "v1.0.0-rc.1",
    "releaseCommit": "<predecessor-product-commit>",
    "releaseTagObject": "<annotated-predecessor-tag-object>",
    "artifactLocator": "s3://<archive-bucket>/<product>/sha256/<predecessor-dist-aggregate-sha256>/bundle.tar.zst",
    "artifactAggregateSha256": "<predecessor-dist-aggregate-sha256>",
    "archiveBytes": 1,
    "archiveSha256": "<predecessor-archive-file-sha256>",
    "artifactManifest": {
      "path": "artifacts/history/release-manifest-1.0.0-rc.1-format-2.json",
      "bytes": 1,
      "sha256": "<sha256>"
    },
    "retrievalEvidence": {
      "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/rollback/retrieval.json",
      "bytes": 1,
      "sha256": "<sha256>"
    },
    "smokeEvidence": {
      "path": "artifacts/release-attestations/v1.0.0-rc.2-evidence/rollback/smoke.json",
      "bytes": 1,
      "sha256": "<sha256>"
    },
    "verifiedBy": "<accountable operator>",
    "verifiedAt": "<canonical UTC timestamp>"
  }
}
```

The byte counts and angle-bracket values above are documentation placeholders and cannot pass. Do not copy them into a candidate record.

Every file reference is repository-relative and contains an exact positive byte count and lowercase SHA-256. The referenced file, every production-smoke screenshot named by schema-5 smoke evidence, every mandatory QA command log, rollback data-safety evidence, and the attestation itself must be regular, non-symlinked, Git-tracked files in a clean checkout.

## Mandatory machine-bound QA checks

`evidence.qaChecks` must contain exactly `typecheck`, `lint`, `unit`, `browser`, `accessibility`, `visual`, `persistence`, `reliability`, `assets`, and `dependencyAudit`. Each canonical JSON record is schema-1 `release-qa-check`, repeats the exact product tag, commit, version, and manifest aggregate, reports `PASS`, and records every required command with canonical UTC start/completion times, exit code zero, and an exact command-output file reference under `qa/logs/`. The verifier rejects missing check names, substituted commands, failed/nonzero results, unbound candidate identities, missing logs, or any QA/accessibility/legal approval that predates completed mandatory evidence.

The fixed commands are defined in `scripts/release-attestation.mjs`. Persistence deliberately requires both the focused Vitest scope and the Playwright migration journey. Accessibility, visual, and reliability retain their focused Playwright scopes in addition to the complete browser matrix. A prose assertion or a `PASS` line in `QA_REPORT.md` cannot replace these structured records.

## Structured approval evidence

Each approval reference must resolve to JSON with exactly this shape. `role` and `scope` use the values shown in the attestation example, and all repeated identity, decision, reviewer, and time fields must exactly match that approval entry.

```json
{
  "schemaVersion": 1,
  "kind": "release-approval",
  "product": "RIVET RIDGE RALLY",
  "version": "1.0.0-rc.2",
  "status": "APPROVED",
  "role": "qa",
  "scope": "release-qualification",
  "productTag": "v1.0.0-rc.2",
  "productCommit": "<product-commit>",
  "manifestAggregateSha256": "<manifest-dist-aggregate-sha256>",
  "approvedBy": "<accountable person>",
  "approvedAt": "<canonical UTC timestamp>",
  "decision": { "status": "PASS", "openP0": 0, "openP1": 0 },
  "supportingEvidence": [
    { "path": "QA_REPORT.md", "bytes": 1, "sha256": "<sha256>" },
    { "path": "LAUNCH_READINESS.md", "bytes": 1, "sha256": "<sha256>" },
    { "path": "docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json", "bytes": 1, "sha256": "<sha256>" },
    { "path": "e2e/visual-regression.spec.ts-snapshots/race-curved-course-canyon-chromium-darwin.png", "bytes": 1, "sha256": "<sha256>" }
  ]
}
```

`decision` is exact and role-specific:

- QA requires `{ "status": "PASS", "openP0": 0, "openP1": 0 }`.
- Accessibility requires `{ "status": "PASS", "unresolvedMandatory": 0 }`.
- Legal requires `status: "PASS"` and boolean `commercialUseCleared`, `assetInventoryCleared`, `trademarkTradeDressCleared`, `privacyCleared`, and `productLicenseCleared`, all exactly `true`.

`supportingEvidence` must be non-empty. QA must hash-bind `QA_REPORT.md`, `LAUNCH_READINESS.md`, the canonical schema-v2 Canyon baseline approval record, and the promoted 1280×720 Canyon PNG. The verifier canonicalizes and hashes both embedded manifests, reapplies the same complete visual-candidate and capture-manifest validators used by guarded promotion, checks the exact 11-frame matrix, response-body/inventory bindings, runtime readiness, capture-before-owner-before-QA chronology, generic/placeholder reviewer rejection, PNG integrity/dimensions/bytes/hash, and owner-approved screenshot identity. The owner-reviewed clean commit must be an ancestor of the product commit, and their Git diff must contain exactly the approval record and promoted baseline; any later product-source change invalidates the chain. Those two visual files are product-tag inputs and may be referenced—but not changed—by the evidence-only commit, so the final verifier reads the same blobs pinned by the product tag. This proves technical consistency, not human authentication: `external-manual-trust-boundary` remains an explicit external trust boundary.

`QA_REPORT.md` must contain exactly one current `**Overall code-owned QA status:** PASS` line, exactly one current `**Release decision:** READY` line, and one single-line candidate marker whose identity and zero-open-P0/P1 result match the approval:

```md
<!-- release-qa-readiness {"schemaVersion":1,"kind":"release-qa-readiness","product":"RIVET RIDGE RALLY","version":"1.0.0-rc.2","status":"READY","productTag":"v1.0.0-rc.2","productCommit":"<product-commit>","manifestAggregateSha256":"<manifest-dist-aggregate-sha256>","openP0":0,"openP1":0} -->
```

`LAUNCH_READINESS.md` must independently contain exactly one current `# READY` decision heading, `**Code-owned gate status:** PASS`, `**Commercial readiness status:** READY`, `**Current final status: READY.**`, and this candidate-bound single-line marker:

```md
<!-- release-launch-readiness {"schemaVersion":1,"kind":"release-launch-readiness","product":"RIVET RIDGE RALLY","version":"1.0.0-rc.2","status":"READY","productTag":"v1.0.0-rc.2","productCommit":"<product-commit>","manifestAggregateSha256":"<manifest-dist-aggregate-sha256>","openP0":0,"openP1":0} -->
```

The current project report intentionally remains `# NOT READY` / `UNVERIFIED` and has no passing marker. Add the marker only to the final candidate report after the real gates and approval facts exist; the verifier rejects a prose-only or stale READY claim.

Other sanitized supporting records live under `artifacts/release-attestations/v1.0.0-rc.2-evidence/approvals/support/`. A prose file or a generic `APPROVED` label by itself is not an approval.

## Structured rollback evidence

The predecessor manifest must be a complete, internally consistent format-2 manifest. Its `source.commit`, annotated tag, tag object, version, build/toolchain provenance—including the schema-valid pinned npm package-tree identity—complete file inventory, and aggregate must match the rollback entry. The aggregate identifies the extracted distribution inventory; the rollback root's positive `archiveBytes` and lowercase `archiveSha256` independently identify the retrieved `bundle.tar.zst` bytes. A historical format-1 checksum list is deliberately insufficient. The currently retained `rc.1` format-1 material therefore cannot satisfy this gate; the release owner must provide a source-bound format-2 predecessor manifest for the retained immutable archive.

The locator must be an absolute credential-free `https:`, `s3:`, or `gs:` URL, must not target a local/private host, and must end in the canonical immutable suffix `/sha256/<predecessor-dist-aggregate-sha256>/bundle.tar.zst`. Queries, fragments, moving path aliases such as `latest`, `current`, `stable`, `production`, or `prod`, relative paths, and local paths fail validation even when the aggregate also appears elsewhere in the URL.

`retrieval.json` is schema-1 `rollback-retrieval` JSON. It must report `PASS` and repeat the product/version/tag/commit/tag-object, locator, predecessor manifest file SHA-256, predecessor artifact aggregate, exact archive byte count and archive SHA-256, named retriever, and canonical retrieval time:

```json
{
  "schemaVersion": 1,
  "kind": "rollback-retrieval",
  "product": "RIVET RIDGE RALLY",
  "version": "1.0.0-rc.1",
  "status": "PASS",
  "releaseTag": "v1.0.0-rc.1",
  "releaseCommit": "<predecessor-product-commit>",
  "releaseTagObject": "<annotated-predecessor-tag-object>",
  "artifactLocator": "<same-content-addressed-locator>",
  "artifactManifestSha256": "<predecessor-manifest-file-sha256>",
  "artifactAggregateSha256": "<predecessor-dist-aggregate-sha256>",
  "archiveBytes": 1,
  "archiveSha256": "<predecessor-archive-file-sha256>",
  "retrievedBy": "<accountable operator>",
  "retrievedAt": "<canonical UTC timestamp>"
}
```

`smoke.json` is schema-1 `rollback-smoke` JSON bound to the same identity, locator, manifest, aggregate, `archiveBytes`, and `archiveSha256` fields. It must report `PASS` without an error, retain a named operator and time, contain exact empty `network.failedRequests`, `network.httpErrors`, and `console.unexpected` arrays, and record exactly these staged steps:

- `artifact-retrieved`
- `database-precondition-native-v60`
- `format-2-manifest-validated`
- `boot-and-version`
- `local-save-read-or-nondestructive-block`
- `progress-track-replay-preservation`
- `race-start-and-restart`
- `offline-service-worker-reload`

The smoke record must also contain one dedicated-origin root `stagedBaseURL` plus complete `servedBefore` and `servedAfter` inventories captured at that exact root. Each inventory repeats the format-2 manifest's file count, raw total, deterministic gzip total, aggregate, and every path's raw bytes/SHA-256 and gzip bytes/SHA-256; its entrypoint must match manifest `index.html`. Missing paths, substitutions, origin drift, a non-root URL, or any pre/post mismatch fails closed.

The smoke record must reference canonical schema-1 `rollback-data-safety` JSON. That record binds the predecessor identity and aggregate, the same dedicated staged-origin root URL used by smoke, a database pre-opened at native IndexedDB version 60, and the tagged `v1.0.0-rc.1` predecessor attempt at native version 30. It must prove either a safe local-save read or a visible non-destructive incompatibility result. Clearing site data or using destructive recovery fails. The fixture must seed at least one progress record, one custom track, and one replay; the matching before/after counts and exact persisted-state snapshot SHA-256 values must remain identical. The data-safety operator and timestamp must exactly match staged smoke.

Retrieval must precede staged smoke, staged smoke must precede the attestation's rollback verification time, and the verifier must be the staged-smoke/data-safety operator.

## What the verifier proves

The command fails unless all of the following are true:

- the annotated product tag still resolves to the recorded product commit and tag object;
- the archived format-2 manifest is internally consistent and records the same version, tag, tag object, commit, raw file hashes, deterministic gzip level-9 hashes/sizes, raw aggregate, and compressed total;
- schema-4 performance and Rival-soak local inventories contain the non-QA manifest's complete path/raw-byte/raw-SHA/gzip-byte/gzip-SHA inventory and exact aggregate, and both pre/post served candidates contain the same complete inventory;
- headed performance uses the exact schema-4 artifact/profile/metric shapes, rejects missing or unknown fields, identifies the exact desktop and emulated-mobile scopes, viewport, device scale, emulation settings, public progress setup, absent product QA/performance APIs, and pre-navigation capture harness, and requires chronology-bound total duration plus positive first-race and public-restart timings. Initial shell readiness ends at the first visible title action before progress setup/reload; first-race load runs from mode activation to engine-ready/countdown and excludes menu traversal plus the fixed countdown. It preserves bounded raw per-frame samples across each five-second window without visibility loss, derives mean FPS from raw frame timestamps, and recomputes p95 from synchronous rAF callback CPU work before applying the fixed gates. Callback work does not claim style/layout, paint, GPU, workers, or microtasks;
- Rival soak uses headed Chromium with hardware-backed WebGL and rejects identified SwiftShader, llvmpipe, or software-rasterizer evidence. It uses the exact schema-4 artifact/sample/attempt/gate shapes and exact desktop or mobile viewport, DPR, touch/mobile emulation, selected quality, runtime version, and public progress setup; its total duration must match recorded chronology, each completed race must have one positive restart timing, restart summaries must recompute from those timings, and the diagnostic/release gates and per-attempt fixed-step summaries/trends must be complete and internally consistent. It starts its raw racing clock at exactly `{ "elapsedMs": 0, "racing": true }`; records at least 30 minutes accrued only while the visible game shell reports `data-race-gate-phase="racing"`; excludes Results/restart/loading/countdown; fails on visibility loss; meets a duration-derived minimum sample count; never leaves a gap over two configured intervals; and has memory, input, and fixed-step summaries/trends recomputed from the raw records;
- schema-5 installed-Chrome smoke binds Google Chrome/channel/version/viewport, exact runtime title/version/commit, `rivet-ridge-rally-shell-v35`, the complete pre/post served inventories, the full journey, and four integrity-checked screenshots; its `createdAt` is the completed-run timestamp and cannot predate `run.startedAt`;
- all ten mandatory structured QA records and command logs bind the same candidate; QA hash-binds the candidate-specific READY states in both final reports plus the canonical owner-approved Canyon record and baseline; the embedded visual manifests pass the full guarded-promotion schemas; the promoted PNG matches the exact approved capture; the product commit differs from the reviewed clean visual commit by only those two promotion outputs; the evidence commit leaves both product-bound visual files unchanged; and every QA, accessibility, and legal approval postdates completed performance, soak, smoke, and every mandatory QA command result;
- the predecessor tag is annotated and immutable; its source-bound format-2 manifest matches the extracted distribution; the root, retrieval, and smoke records bind one exact positive archive byte count and archive SHA-256; both rollback smoke inventories match every predecessor raw/gzip manifest record at one staged root URL; and structured data-safety evidence proves the native-60 to native-30 downgrade is safe or non-destructively blocked without altering the seeded progress record(s), custom track(s), or replay(s), with at least one of each present;
- the product commit is an ancestor of the clean evidence commit, the evidence diff contains the attestation, and every added/modified path is one of the attestation's canonical evidence files or the two final reports; copies, deletions, renames, product source, dependencies, assets, and release-tool changes fail;
- the clean evidence commit is the target of annotated tag `attestation/v1.0.0-rc.2`.

Changing the harness evidence schemas, mandatory criterion sets, smoke journey, approval/rollback contract, or fixed performance budgets requires a new attestation schema version. Do not loosen version 3 to accept a materially different evidence contract.

## Final verification

Create the evidence-only commit and annotated attestation tag only after every real gate and human review has passed. Then run from that clean tagged checkout:

```sh
npm run release:attestation:verify -- \
  --attestation artifacts/release-attestations/v1.0.0-rc.2.json
```

The command exits nonzero on any mismatch and prints one `PASS` summary only after the entire chain verifies. Its source regression command is:

```sh
npm run test:release-attestation
```

The 70 source fixtures pass. The final verifier has not run because no clean tagged candidate attestation exists.

Approval records should contain only the decision, scope, product identity, reviewer identity, UTC time, and safe supporting references. Do not commit confidential legal work product, credentials, private host locators, or personal data; retain those in the owner's controlled system and commit a sanitized candidate-bound approval record.
