# Handoff: Operator Scorecard — Power BI Custom Visual (pbiviz)

**For:** Claude Code build session on local machine
**From:** Cowork planning session, 4 Aug 2026
**Status:** Spec LOCKED and signed off. Build to this document; data role changes = renegotiate first.

---

## Context

Hancock Iron Ore / Roy Hill weekly personal scorecards for grader ops, digger ops, dozer ops, coordinators, supervisors, watercarts. One reusable visual, configured per role via format pane. Reference design: "Roy Hill Grader Op Scorecard — June 2026" (T. Baker example — hero photo header, big headline number, rank chip, 4 KPI tiles, 6-month dual-line trend, peer quadrant scatter, blue swing-summary box).

**Known constraint (accepted by Harry):** uncertified custom visuals render BLANK in Power BI email subscriptions and PDF export. This visual is for on-screen report use; the emailed version uses a parallel native+Deneb page unless/until this visual passes Microsoft certification. Build for certification-readiness anyway (high-contrast support, no external network calls, no innerHTML from data).

---

## Locked Spec

**One-liner:** Full-page personal scorecard — hero headline with rank, info strip, 4 KPI tiles, trend, crew peer quadrant, summary box — configurable per role entirely from the format pane.

### Data roles (THE CONTRACT — role `name` keys are permanent once shipped)

| Role name | displayName | Kind | Cardinality | Required | Example field |
|---|---|---|---|---|---|
| `person` | Person | Grouping | 1 | yes | dim_person[display_name] |
| `date` | Date | Grouping | 0–1 | no | dim_calendar[date] (trend only) |
| `headline` | Headline Value | Measure | 1 | yes | [Hours On Machine] |
| `focusFlag` | Focus Person Flag | Measure | 1 | yes | [Is Selected Person] (1 = "YOU", else 0) |
| `kpis` | KPI Values | Measure | 0–4 | no | [UoA %], [Productive Time %], … |
| `trendValues` | Trend Values | Measure | 0–2 | no | [UoA %], [Productive Time %] |
| `quadX` | Quadrant X | Measure | 0–1 | no | [Effective Utilisation] |
| `quadY` | Quadrant Y | Measure | 0–1 | no | [Proximity Stoppages] |
| `info` | Info Values | Measure | 0–3 | no | [Primary Machine], [Primary Region], [Shifts] (text measures OK) |
| `summary` | Summary Text | Measure | 0–1 | no | [Swing Summary] (generated in Databricks, lands as measure) |
| `tooltips` | Tooltips | Measure | 0–n | no | — |

### Dataview shape & in-visual aggregation

- Categorical mapping, grain = **person × date** (categories: person, date — two category columns; if `date` unfilled, grain is person only).
- The visual aggregates internally:
  - **Headline, KPIs, quadrant X/Y**: aggregate per person over all received dates (sum or avg — make aggregation mode a format setting per measure group, default avg for %-like, sum otherwise; simplest v1: use values as-delivered when date absent from well, avg when present).
  - **Trend**: group by month from `date`, plot 0–2 series for the focus person only.
  - **Rank**: rank of focus person's headline value among ALL persons received. Direction setting (higher-is-better toggle) flips comparison. Rank chip shows `#n / count` and delta vs previous period is OUT OF SCOPE v1.
- **Crew scoping stays OUTSIDE the visual** — page/subscription filters deliver only the peer crew. The visual ranks whoever arrives.
- Focus person = row(s) where `focusFlag` ≥ 1. Zero or multiple focus persons → render empty state with instruction.
- dataReductionAlgorithm: top 30000 (peers × ~190 days is small; declare generous cap).

### Sections (stacked, each with show/hide toggle)

1. **Hero header** — background image (URL format setting) + dark scrim, site name (top-left, logo style: "HANCOCK / IRON ORE" text block is NOT reconstructed — leave logo out of v1, site name text only), title + period label top-right, headline label, big headline number + units, target chip ("TARGET x · ±y%"), rank chip ("RANK #n / m · ▲/▼"). Rank arrow = movement vs target midpoint is OUT OF SCOPE; chip shows rank only in v1.
2. **Info strip** — 4 cells: Person (from category) + up to 3 `info` measures with configurable labels (defaults: OPERATOR / PRIMARY MACHINE / PRIMARY REGION / SHIFTS).
3. **KPI tiles** — up to 4, from `kpis` role order. Each: label (setting), value + units, target (setting), delta vs target with ▲/▼ and good/bad colour by per-KPI direction toggle. Coloured top border: teal when meeting target, orange/coral otherwise (fx-overridable).
4. **Trend** — line chart, monthly aggregation, 0–2 series from `trendValues`, legend top-left, y-axis auto with min/max settings, x-axis month ticks.
5. **Peer quadrant** — scatter of all persons: X = `quadX`, Y = `quadY` (support inverted Y — "fewer is better up" toggle). Dashed threshold lines at configurable X/Y values. 4 shaded quadrant backgrounds + 4 corner labels (all settings, fx-able). Focus dot: enlarged, Hancock Deep Blue, labelled "NAME · YOU". Peer dots: grey, surname label, cap labels at 15 peers then labels off. Footnote sentence BELOW quadrant is a text measure? No — out of scope; page-level text box handles it.
6. **Summary box** — dark blue rounded box, title setting ("SWING SUMMARY"), body = `summary` measure text. Plain text only (no inline bold parsing v1).

### Empty/degenerate behaviour (must not throw — ever)

- No dataview / empty categories → branded landing state: "Add Person, Headline Value and Focus Flag"
- Missing optional roles → section auto-hides
- 1 person only → rank shows "#1 / 1", quadrant renders single dot
- All-null measures → tile shows "–"
- Tiny viewport while dragging → clamp negative areas, bail cleanly
- 10k+ rows → aggregate normally; decimate trend points if > 400

### Interactions

- **Cross-filter (outbound):** quadrant dots only. Click → `selectionManager.select()`, Ctrl/Cmd multi-select, click empty space clears. Selection IDs built with `withCategory(personColumn, i)`, rebuilt every update().
- **Highlight (inbound):** `values[].highlights` array → dim non-highlighted quadrant dots to 0.3 opacity. Simple-dim rendering (not partial marks).
- **Context menu:** right-click any dot → `showContextMenu`.
- **Tooltips:** host tooltipService on quadrant dots + KPI tiles, include `identities`. `tooltips` role fields appended.
- Everything else display-only.
- Restore selection after resize/bookmark: re-apply from `selectionManager.getSelectionIds()` at end of update().

### Formatting pane — ALL colour + text properties fx-enabled (`ConstantOrRule`)

| Card | Properties | Default |
|---|---|---|
| Header | Site name (text), Title (text), Period label (text), Image URL (text), Scrim opacity | "ROY HILL" / "EQUIPMENT SCORECARD" / "" / "" / 0.55 |
| Headline | Label, Units, Target (num), Higher-is-better (bool), Show target chip, Show rank chip | "HEADLINE METRIC" / "" / 0 / true |
| KPI 1..4 (4 cards or composite) | Label, Units, Target (num), Higher-is-better (bool) | — |
| Trend | Show, Series 1/2 labels, Y min/max (auto blank), Line colours | Deep Blue / Teal |
| Quadrant | Show, X threshold, Y threshold, Y inverted (bool), Corner labels ×4, Quadrant fills ×4, Peer dot colour, Focus dot colour, Label font | — |
| Summary | Show, Title, Box colour, Text colour | "SWING SUMMARY" / Deep Blue |
| Section toggles | Hero/Info/KPI/Trend/Quadrant/Summary show | all on |
| Text | Font family/sizes per zone (FontControl) | see brand |

fx implementation is three-way per the checklist below — **capabilities `rule` block + `instanceKind: ConstantOrRule` + render path reads `objects[i]` override before falling back to the constant.** A missed leg = silent failure. Numeric targets: `TextInput`/numeric with ConstantOrRule so the scorecard_config table measures can drive them per role.

### Out of scope (v1, agreed)

Email/PDF rendering (uncertified), inline-bold summary text, Databricks connectivity, multi-person layouts, rank-movement arrows, logo image (text site name only), footnote sentence under quadrant.

---

## Hancock brand tokens (defaults — authoritative hex)

| Token | Hex | Use in this visual |
|---|---|---|
| Hancock Deep Blue | `#006A9D` | Primary: focus dot, trend series 1, summary box, chips |
| Hancock Cyan | `#00AFD0` | Secondary accents |
| Hancock Teal | `#00917B` | Favourable delta / meeting-target border, trend series 2 |
| Hancock Mint | `#5AC28D` | Top-performer quadrant tint (light) |
| Hancock Coral | `#F15B55` | Adverse delta / below-target |
| Hancock Orange | `#F68C50` | Secondary warning, at-risk tint |
| Hancock Pink / Soft Pink | `#E77D9A` / `#EBA6B8` | Spare categorical / soft backgrounds |
| Black / White / Mid Grey | `#000000` / `#FFFFFF` / `#7F7F7F` | Text / backgrounds / peer dots, gridlines |

Rules: Deep Blue leads. Delta colouring: Teal = good, Coral = bad — never raw red/green. Multi-series order: Deep Blue, Cyan, Teal, Coral, Mint, Orange, Pink, Soft Pink. No arbitrary tints except the quadrant background washes (use ~8% opacity fills of Mint/Coral/neutral). Font: `Gilroy, "Gilroy Semibold", Aptos, "Segoe UI", Arial, sans-serif` (Gilroy is paid — the stack degrades to Segoe UI inside Power BI). Sizing cues from reference design: headline ~54pt, section headers ~10pt uppercase letter-spaced, tile values ~24pt.

High-contrast: honour `host.colorPalette.isHighContrast` — switch to `foreground`/`background`/`foregroundSelected`. Required for certification.

---

## Build instructions

```bash
# Node 18+
npm install -g powerbi-visuals-tools@latest
pbiviz new HancockOperatorScorecard -t default
cd HancockOperatorScorecard && npm install
# deps: d3, powerbi-visuals-utils-formattingmodel, powerbi-visuals-utils-tooltiputils
```

Key implementation notes (hard-won traps):

1. `update()` is hot — build SVG containers in constructor, data-join in update(). It fires on resize with identical data; check `options.type & VisualUpdateType.Resize` to skip re-transform.
2. `options.dataViews` can be undefined/partial on first render, bad field drop, or field removal. Optional-chain everything. `dataViews[0].categorical.categories[0]` unguarded is the #1 custom-visual crash.
3. Two-category mapping (person × date): categories arrive as parallel columns; person repeats per date. Aggregate by distinct person value. Selection IDs from the person column only.
4. `getFormattingModel()` must exist or the pane won't render. `name`/`propertyName` in settings.ts must EXACTLY match capabilities objects keys — mismatch silently drops the control.
5. fx read-back: rule results land in `categories[0].objects[i]`; constants in settings. Read override first: `objects?.[i]?.cardName?.propName` → fallback to `this.settings...`. Reading only settings makes fx appear configured but do nothing.
6. Changing role `name` keys after ship breaks every report using the visual. `displayName` changes are safe.
7. Sandbox iframe: no external fonts/network at runtime (also a certification requirement). Image URL setting: render via `<image>` href — document that data: URLs and https CDN images work but https requires report-level privacy acceptance; test both.

Dev loop: `pbiviz start` + Developer Visual enabled (Desktop: File → Options → Preview features). Package: `pbiviz package` → `dist/*.pbiviz`. Import: Visualizations pane → ⋯ → Import a visual from a file.

## Test checklist (run before handover — use a fresh-context agent if available)

- [ ] `npm run lint` + `pbiviz package` clean
- [ ] Demo CSV: 8 persons × 60 days, 1 focus person, 4 KPIs, 2 trend measures, quad X/Y — renders all 6 sections
- [ ] Rank correct both directions (higher-better and lower-better)
- [ ] Cross-filter: dot click → `selectionManager.select()` with valid ID; others dim; empty-space click clears; Ctrl multi-select
- [ ] Highlight: dataview with `highlights` array → non-highlighted dots dim
- [ ] Empty dataview → landing state, no exception. Single person, all-null measures, missing optional roles — no exception
- [ ] EVERY colour/text/target property: `rule` block in capabilities + ConstantOrRule + override read in render path; set one fx rule on a measure and confirm it visibly applies
- [ ] Formatting pane enumerates without error; section toggles hide sections
- [ ] High-contrast mode renders legibly
- [ ] Resize storm (drag small→large) — no crash, selection persists

## Definition of done

`HancockOperatorScorecard.pbiviz` + SPEC (this doc) + note listing fx-enabled properties. If rolling out org-wide: a Fabric admin uploads to the org visual store (Admin portal → Organizational visuals) rather than file-by-file import.

---

## Model-side contract (already planned in Power BI, not part of visual build)

- `[Is Selected Person]` measure: 1 when person = subscription/filter person
- scorecard_config "Enter data" table drives titles/targets per role via fx-bound measures (role_key | title | headline label/metric/target/units | kpi1..4 | peer_scope)
- Recipient table: operator ↔ email ↔ supervisor ↔ role_key ↔ crew (drives dynamic per-recipient subscriptions)
- Headline/KPI SWITCH measures on `headline_metric_key`
- Page filter scopes crew; subscription filters person + role_key
