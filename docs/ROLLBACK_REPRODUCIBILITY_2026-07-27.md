# Rollback Reproducibility — 2026-07-27

**Scope:** gate 10 of `docs/RC2_REMAINING_GATES_CHECKLIST.md` (rollback proof and data safety).
**Method:** fresh `git clone --depth 1 --branch <tag>` from `origin`, then `npm ci` and `VITE_QA_MODE=0 npm run build` on the pinned toolchain (Node `26.4.0` / npm `11.17.0`), in a throwaway directory outside the working repository. Scratch clones were deleted afterwards.

This tests the question gate 10 actually asks: **can a previous release be recovered and rebuilt?** Source retrievability alone was proven on 2026-07-26 when the predecessor tag was published; this goes further and tries to rebuild the artifact.

## Result: `v1.0.0-rc.1` cannot rebuild — `v1.0.0-rc.2` can, byte for byte

### `v1.0.0-rc.1` — **FAILED**

Clone and `npm ci` both succeeded from the tag published on 2026-07-26 (commit `25eeebe735b56b969205ebff712bf84bbbea5399`, `package.json` version `1.0.0-rc.1`). The build then failed at the predecessor's **own** asset verification:

```
AssertionError: public/assets/transcoders/basis/LICENSE.txt byte length
  actual:   9141
  expected: 9197
```

Cause: at rc.1, `scripts/build-3d-assets.mjs` copied `node_modules/typescript/LICENSE.txt` into `public/assets/transcoders/basis/LICENSE.txt`. The file checked in at that tag is 9,141 bytes while rc.1's own asset manifest requires 9,197, so the tagged commit is internally inconsistent and its `prebuild` gate refuses it.

**This is fixed at HEAD** and is not a live defect: the current file is the genuine 9,197-byte Apache License 2.0 text, and `ASSET_LICENSES.md` describes it accurately, including the honest note that it is not a byte-for-byte copy of Basis Universal's differently formatted upstream file.

**Consequence for rollback:** rc.1 cannot be rebuilt from source, and no built rc.1 artifact was ever archived. **rc.1 is not a usable rollback target by either route.**

### `v1.0.0-rc.2` — **REPRODUCIBLE, VERIFIED**

Clone, `npm ci` and build all succeeded from commit `2b4069538c242da37c8c43d6581e097149fa1994`.

The rebuilt `dist/` was compared against the archived format-2 manifest at `artifacts/history/release-manifest-1.0.0-rc.2-format-2.json`:

| Check | Archived manifest | Fresh rebuild | Result |
|---|---:|---:|---|
| File count | 33 | 33 | match |
| Raw bytes | 8,011,146 | 8,011,146 | **exact** |
| **Per-file byte length and SHA-256** | 33 entries | 33 entries | **33 / 33 exact** |

Spot values from the rebuild, matching the figures recorded in `QA_REPORT.md`: `index.html` 1,632 B; `THIRD_PARTY_NOTICES.txt` 43,872 B / `f837ed70…`; `assets/3d/hero-bike-rider.glb` 517,664 B / `538be426…`; `sw.js` 9,029 B; `manifest.webmanifest` 856 B.

One caveat stated plainly: the *aggregate* hash computed here (`a9650eaf…`) differs from the manifest's (`e7af57d5…`) because the two use different aggregation algorithms over the same per-file digests. **The bytes match; only the roll-up method differs.** The per-file comparison above is the authoritative check.

## What this changes for gate 10

The readiness documents record rollback as `UNVERIFIED` on the grounds that no artifact locator, byte count or SHA-256 exists. That is now partly answered, and the answer differs by tag:

- **A viable rollback target exists and is reproducible on demand** — `v1.0.0-rc.2`, rebuildable byte-for-byte from a published tag with its own lockfile. That is a meaningfully stronger position than "no deployable predecessor".
- **The nominal predecessor is not viable.** Any rollback plan naming rc.1 should be corrected to name rc.2.

## What gate 10 still needs

Reproducibility is necessary, not sufficient. Still outstanding:

1. **A durable archive location** for the built artifact. Rebuild-on-demand depends on GitHub, npm and the pinned toolchain all being available during an incident, which is exactly when that is least safe to assume.
2. **A staged rehearsal** with complete matching pre/post served raw and gzip inventories, proving the bytes actually reach a served root.
3. **The data-safety record** — the native-60 → native-30 downgrade path for local saves.
4. **Named ops ownership** for executing a rollback.

Items 1, 2 and 4 need a hosting and operations decision, so they remain owner-blocked.

## Reproducing this check

```sh
git clone --depth 1 --branch v1.0.0-rc.2 https://github.com/jbrackens/rivet-ridge-rally.git rc2-check
cd rc2-check && npm ci && VITE_QA_MODE=0 npm run build
```

Then compare `dist/` per-file against `artifacts/history/release-manifest-1.0.0-rc.2-format-2.json`.
