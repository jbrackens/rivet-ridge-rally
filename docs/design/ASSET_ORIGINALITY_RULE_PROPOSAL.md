# Proposal — rewrite the asset originality rule

**Status:** DRAFT FOR OWNER DECISION. Nothing here is applied. The three contracts are
unchanged and the rc.3 review package is untouched.

**Why this document exists rather than a direct edit:** the three contracts are hash-bound
into the shipped asset manifests, so editing them regenerates product bytes and invalidates
the review package currently awaiting owner signature. This proposal is reviewable without
paying that cost.

---

## The problem, stated precisely

### 1. The written rule and the enforced rule disagree

`HERO_BIKE_RIDER_VERTICAL_SLICE.md` requires "project-authored Blender geometry".
`scripts/build-hero-bike-rider-assets.mjs` enforces something much narrower:

| Enforced | Where |
|---|---|
| `authoring_script_sha256` must match one specific `.py` file | `:526` |
| `authoring_blender_version` must equal exactly `"4.5.11 LTS"` | `:530` |
| `authoringProcedure` pinned to `build_hero_bike_rider.py` | `:1160` |

Consequences nobody chose:

- **Hand-modelling in Blender fails the build.** It satisfies the written rule completely and
  is obviously non-infringing, but there is no authoring script to fingerprint.
- **Upgrading Blender breaks the build.** Moving to 4.6 fails `assets:verify` until someone
  edits the checker. The pin protects reproducibility, but silently, in a place nobody reading
  the contract would look.

### 2. The first sentence bans methods, not outcomes

The rule's actual protective purpose is stated in its own later sentences: do not reproduce a
real manufacturer's design or anyone else's trade dress. That is an **outcome** rule and it is
well drafted.

"Must be created from project-authored Blender geometry" is a **method** rule. It forbids
tools that would produce equally original results, so it costs flexibility without buying
protection. A hand-modelled bike and a generated bike are equally infringing or equally clean
depending on *what they look like*, not on which program made them.

### 3. It is already inconsistent with what the project ships

`ASSET_LICENSES.md` records that the game ships **two OpenAI-generated raster backgrounds**,
and that the 3D work was modelled from **eight OpenAI-generated reference images**. Generated
content is already in the product and already handled carefully — the hero contract even has a
clause telling authors not to copy the fake sponsor marks that appear in those generated
references. So a blanket "authored, not generated" reading was never the real policy.

---

## Proposed replacement

### For `HERO_BIKE_RIDER_VERTICAL_SLICE.md` — replaces the first sentence only

> Every shipped model and texture must carry **recorded, verifiable provenance**: what produced
> it, from which inputs, at which version, and when — each recorded in the asset inventory and
> bound by hash in the asset manifest. Any production method may be used, including authored
> Blender scripts, hand modelling, procedural generation, and generative tools, provided that
> record exists and the originality rules below are satisfied. Method is not the safeguard;
> the recorded provenance and the originality rules are.

The two following paragraphs are **kept verbatim**. They are the part doing the real work:

> Do not download, kitbash, scan, trace, or modify a commercial motorcycle, branded riding
> suit, platform-branded block avatar, marketplace model, stock texture, proprietary logo, or
> third-party game asset. Do not reproduce a real manufacturer's frame, plastics, engine
> casing, helmet shell, livery, sponsor layout, or distinctive trade dress.
>
> Incidental pseudo-lettering, star-like decals, or sponsor-like marks visible in the generated
> reference are not approved artwork and must not be copied. Permitted identity is limited to
> the project palette, an original rivet/bolt or ridge motif, and the player number `22`. Any
> additional visible word mark, badge, icon, or decal requires separate provenance and
> owner/legal review.

### One rule that must be ADDED if generative tools are permitted

The current rules assume a human chose every shape. A generative tool does not know what a KTM
looks like versus an original design, so the existing outcome rules need an explicit
verification step rather than an implicit one:

> Any model produced by a generative tool requires a recorded **similarity check before
> promotion**: the reviewer confirms the result does not resemble an identifiable real-world
> manufacturer's design or an identifiable third-party character, and records that check in the
> asset inventory alongside the tool, model version, prompt, and date. The tool's own output
> licence must also be recorded and permit commercial use.

Without this addition the rewrite is **weaker** than what it replaces, because the Blender-only
rule was accidentally providing this guarantee by making a human responsible for every vertex.

### For `RIVAL_PACK_VERTICAL_SLICE.md`

Replace "The pack uses only project-authored Blender-native geometry" with "The pack uses only
models carrying recorded, verifiable provenance as defined in the hero contract". The rest of
the sentence — the list of prohibited sources — is kept verbatim.

### For `CANYON_VERTICAL_SLICE.md`

**No change needed.** Its rules are already written as outcomes ("avoid … brand marks, readable
sponsor text, platform-branded block-avatar proportions, or a direct imitation of any
third-party game's assets") and never mandated a method.

---

## What the pipeline change would involve

`build-hero-bike-rider-assets.mjs` and its rival and Canyon siblings currently accept exactly
one provenance shape. They would need a second: a `generated` record carrying tool name, model
version, prompt hash, output licence, and similarity-check reference — validated as strictly as
the Blender record is today, and equally hash-bound.

The Blender-script path stays supported and stays the default. Nothing existing is invalidated.

**The Blender version pin should be relaxed separately and regardless of this decision**, since
it fails the build on a routine tool upgrade. Suggested: accept a recorded minimum version
rather than one exact string, and record the actual version used.

---

## What this does and does not change

**Permits that the current rule forbids:** hand modelling in Blender; upgrading Blender without
editing a script; procedural or generative geometry with recorded provenance and a passed
similarity check.

**Still forbids exactly as before:** downloading, kitbashing, scanning, tracing or modifying
commercial models, marketplace assets, stock textures, logos, or third-party game assets;
reproducing any real manufacturer's design or trade dress; copying sponsor-like marks from
reference images.

**Deliberately unchanged:** every model still binds by hash into the asset manifest, and
`assets:verify` still fails closed on any mismatch. Provenance becomes broader, never optional.

---

## Sequencing

1. Owner decides on this proposal.
2. If accepted, apply **after** the rc.3 review package is signed and promoted — the edit
   regenerates product bytes and would invalidate the frozen package mid-flight.
3. If the motive is to unblock a specific tool, read that tool's output-licence terms **first**.
   A rewrite that admits a tool whose terms fail the commercial-use requirement helps nobody.
