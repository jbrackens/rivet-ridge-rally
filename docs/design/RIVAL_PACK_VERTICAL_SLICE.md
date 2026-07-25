# RIVET RIDGE RALLY — Shared Rival Pack Vertical Slice

## Purpose

Replace the primitive Rival and Mastery presentation with one original lower-detail authored bike-and-rider rig while preserving every existing AI simulation and fail-safe procedural fallback. The player hero remains a separate focal asset; this pack supplies a coherent secondary field without duplicating five complete source models.

## Originality and visual direction

The pack uses only project-authored Blender-native geometry, a project-generated seven-segment number field, and the existing fictional entrant palettes. No downloaded model, marketplace asset, stock texture, logo, sponsor mark, manufacturer shape, platform-branded block avatar, or third-party character may be included.

The target is a readable secondary silhouette: continuous knobby tires, clear wheel hubs, fork, engine, exhaust, tank/shroud, side-number field, helmet, torso, arms, knees, and boots. It should support the hero rather than compete with its detail density.

## Exact base hierarchy

```text
RRR_RivalPackBase
├── RRR_RivalBikeVisual
│   ├── BikeStatic_Primary
│   ├── BikeStatic_Accent
│   ├── BikeStatic_Hardware
│   ├── BikeStatic_NumberField
│   ├── bike-steering-pivot
│   │   └── bike-front-suspension-pivot
│   │       └── FrontTire
│   │           └── FrontWheel_Wheel
│   └── bike-rear-suspension-pivot
│       └── RearTire
│           └── RearWheel_Wheel
└── rival-rider
    ├── rider-torso-pivot
    │   ├── RivalTorso_Primary
    │   ├── rider-head-pivot
    │   │   └── RivalHead_Accent
    │   ├── rider-left-arm-pivot
    │   │   └── RivalLeftArm_Accent
    │   └── rider-right-arm-pivot
    │       └── RivalRightArm_Accent
    ├── rider-left-leg-pivot
    │   └── RivalLeftLeg_Primary
    └── rider-right-leg-pivot
        └── RivalRightLeg_Primary
```

All names are unique. The scene is `RRR_RivalPackScene`. Root, bike, and rider transforms are identity. Wheels spin around local `+X`; the six rider pivots remain the existing snapshot-driven runtime pose hooks.

## Materials and variants

The base exports exactly five opaque PBR materials:

| Material | Role |
|---|---|
| `RRR_RivalPrimary` | dominant plastics and suit panels |
| `RRR_RivalAccent` | secondary plastics, armor, and helmet |
| `RRR_RivalHardware` | frame, fork, engine, swingarm, and exhaust |
| `RRR_RivalWheel` | dark tire, tread, rim, spoke, hub, and brake silhouette |
| `RRR_RivalNumberField` | opaque project-generated side-number field |

Runtime clones the decoded hierarchy five times while sharing mesh geometry. It clones materials per entrant, applies the existing primary/accent colors, and replaces only the number-field texture with original seven-segment variants `17`, `31`, `46`, `58`, and `73`.

## Budgets

| Metric | Contract |
|---|---:|
| Base triangles | 15,000–20,000 |
| Base mesh-bearing nodes | 8–12 |
| Base render primitives | 8–12 |
| Base materials | exactly 5 |
| Embedded source textures | exactly 1 opaque 128×64 PNG |
| Runtime clones | exactly 5 |
| Optimized runtime GLB | no more than 2 MiB |

The public delivery directory is isolated at `public/assets/rivals` and contains only `rival-pack.glb` and `asset-manifest.json`. The exact hero directory contract at `public/assets/3d` must not change because of this pack.

## Atomic runtime fallback

Rival and Mastery races create the complete procedural AI field first. A separate bounded loader decodes and validates the rival base without mutating live riders. Only after all five clones, material variants, number fields, wheel hooks, and six-pivot rigs resolve does the engine attach every authored clone, update all presentation references, and hide all ten procedural bike/rider groups in one transaction.

Failure, malformed data, timeout, disposal, or partial preparation leaves every procedural rival visible and usable. The asset never changes AI simulation, collision, course placement, race ordering, or gameplay authority.

## Deferred qualification

Blender generation and isolated Meshopt optimization may proceed during the owner’s test pause. Independent verification, application tests, browser/runtime capture, offline checks, performance and memory evidence, accessibility review, and owner/legal acceptance remain deferred until testing resumes.
