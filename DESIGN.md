# Fibi — Daily Fiber Planner

**Design v2 · July 2026** (v1 mockups: https://claude.ai/code/artifact/e2bfe184-1095-4bad-a524-60a54a46b839)

> **v2 changes (as built):** Fibi is an installable **PWA** (React + Vite + Dexie/IndexedDB), not React Native — Justin chose standalone install over the App Store, which makes it $0 and Windows-buildable. Hosted as static files on **GitHub Pages** (`jam-sn-dev.github.io/my-fiber-tracker`); zero backend, all data on-device. The Anthropic API key is pasted once into Settings (stored on-device) and the app calls Claude directly from the browser. Three lanes were added on request: **Scan a list** (photo of a handwritten/typed food list → bulk review → library), **From a link** (Home Chef recipe URL → Claude's server-side web-fetch reads the page → confirm card; Home Chef publishes carbs + net carbs, so fiber is derived as the difference and flagged; fallback is scanning the boxed recipe card), and **Voice commands** (🎤 in the Today header: speak "plan my breakfast for 5 g with oatmeal and berries" / "add green pepper to my foods, 1 g per serving" / "I had an apple for a snack" → Claude parses to a structured command resolved against her library → one-tap confirm card → executed; live speech recognition where supported, iOS keyboard-dictation textarea as the always-works fallback, mode remembered per device). Fill-the-gap suggestions are a **local learning engine** (favorites, frequency, recency-variety, learned slot habits) — no network needed. A bundled offline USDA dataset (~145 generic foods) backs the database-search lane.

## The problem

One user (Justin's wife) must consume a prescribed amount of dietary fiber every day — typically 20–25 g, and the number can vary. Meal planning currently takes about an hour a day because she has to:

1. Re-look-up fiber values for foods she's eaten many times before
2. Add up totals for meals and the day by hand
3. Figure out what to add when the day comes up short

**Goal: plan a full day in under 3 minutes.** Success metrics:

- Log a known food: ≤ 2 taps
- Enter a new food from a label: ~10 seconds
- Plan a full day: < 3 minutes
- Arithmetic required of the user: zero

Important framing: the target is a **floor, not a ceiling** — the app encourages meeting or exceeding it, never restricting.

## Core loop (the whole daily experience)

1. Open **Today**. Target already set to her usual default (tap the target chip to change it for the day).
2. Tap **Start from yesterday** or a saved day template; tweak meals.
3. Ring shows grams still to plan → tap **Fill the gap** → one-tap-add a suggestion.
4. Through the day, check entries off as eaten. Ring fills; gap recalculates live.

## Screens

Three tabs + two modal flows:

### 1. Today (home tab)
- Header: date, editable **target chip** (e.g. "Target 22 g")
- **Progress ring** with two arcs: solid green = eaten, light green = planned-not-yet-eaten, track = remaining to target. Center: "X g still to plan" (or "Goal met! 23.5 g" state)
- **Fill the gap** button (berry accent) appears whenever planned total < target
- Slot list: **Breakfast / Lunch / Snack / Dinner**. Each row: check-off circle, item name, fiber grams. Empty slots show dashed "+ Add"
- Tapping + on a slot: recent/favorites picker, search library, or new-food flows

### 2. Fill the gap (modal)
- Header: "N g to go · suggestions from your own library"
- Ranked suggestion cards: name, grams, why ("Your meal · last had Monday"), target slot, one-tap **Add**
- Ranking: fit to missing grams + empty slot + recency (variety — rotate suggestions) + favorites. Prefers her own foods/meals; can compose simple 2-food combos ("Apple + 2 tbsp peanut butter — 6.3 g")
- Footer note: going over is fine

### 3. New food (modal) — four entry lanes, one confirm card
1. **Barcode scan** (~3 s): Open Food Facts lookup → name/serving/fiber autofilled
2. **Label photo** (~10 s): camera or camera-roll screenshot → Claude vision extracts serving size + dietary fiber
3. **Database search** (~5 s): bundled USDA FoodData Central subset (works offline) for produce/generics
4. **Type or dictate**: free text ("half cup cooked lentils and two slices of Dave's Killer bread") → Claude parses to foods+quantities; estimates flagged "est."

All lanes end at the same **confirm card** (name, serving, fiber — every value tappable to edit) with Save. Nothing is saved without her confirmation.

### 4. Library (tab)
- Segmented control: **Foods | Meals**; search field
- Rows: favorite star, name, serving label, fiber grams. Sort: favorites, then most-used
- FAB "+" → the four entry lanes; meal builder composes foods with quantities and computes total
- Ship with a **starter library** (~60 common high-fiber foods with USDA values) so day one isn't empty

### 5. History (tab)
- Month calendar; each day colored: **hit** (green) / **close** (amber, within ~2 g) / **missed** (grey)
- Stat chips: days hit, daily average, best streak
- Tap a day → full detail of what was eaten
- **Share last 30 days as PDF** (for her dietitian) — Phase 3

## Where AI is used (Claude API)

| Job | Model | Notes |
|---|---|---|
| Label reading | Haiku (vision) | Photo → structured {name?, servingLabel, fiberPerServing}. Fraction of a cent per scan |
| Fill-the-gap suggestions | Sonnet | Input: gap grams, empty slots, library summary, last-7-days items. Output: ranked shortlist w/ reasons |
| Free-text/dictation parsing | Haiku/Sonnet | Text → foods + quantities; unverified values flagged "est." |
| Weekly insights (Phase 3) | Sonnet | "Tuesdays run short at dinner" |

**Guardrails (non-negotiable):**
- AI proposes; she decides — every AI output passes through a confirm card before touching data
- Privacy: food history stays on-device. Only a label photo or a short list of food names is ever sent — never her health record
- Offline-degradable: logging, totals, reuse, history all work with no network; AI features are conveniences on top

## Data model

```
Food   { id, name, brand?, servingLabel ("1 slice (45 g)"), fiberPerServing,
         source: label|barcode|usda|manual, favorite, timesUsed, lastUsed }

Meal   { id, name, items: [{foodId, qty}], slotHint?, totalFiber (computed) }

Day    { date, targetGrams, entries: [Entry],
         eatenTotal (computed), plannedTotal (computed) }

Entry  { ref: foodId|mealId, qty, slot: breakfast|lunch|snack|dinner,
         state: planned|eaten }
```

The **planned/eaten split** is the core idea: she plans in the morning, and the same entries become the historical record as she checks them off. Totals are always computed, never typed.

## Tech stack

| Layer | Choice (v2, as built) | Why |
|---|---|---|
| App | **PWA**: React 19 + TypeScript + Vite + vite-plugin-pwa | Installs from Safari via Add to Home Screen — standalone, offline, no App Store, no $99/yr, works on Android too |
| Storage | **IndexedDB on device** (Dexie) + `navigator.storage.persist()` | Offline-first, no accounts, no server; JSON export/import backup in Settings |
| AI | Claude API (`claude-opus-4-8`) **direct from the browser** (`dangerouslyAllowBrowser`), key stored on-device in Settings | Zero backend; label/list photos via vision + structured JSON, Home Chef links via the server-side `web_fetch` tool (no CORS, no proxy) |
| Food data | Bundled offline USDA subset (~145 generics) + 59-food seeded starter library | Free, works offline |
| Hosting | **GitHub Pages** via GitHub Actions (`.github/workflows/deploy.yml`, base `/my-fiber-tracker/`) | $0 forever; push = deploy; installed app self-updates |

## Distribution (v2: PWA install — no app store at all)

- **iPhone** (her phone): open the GitHub Pages URL in Safari → Share → **Add to Home Screen**. Runs standalone/full-screen with its own icon, works offline, camera works for scans. Home-screen web apps are exempt from Safari's 7-day storage eviction; `storage.persist()` + JSON backups belt-and-suspenders it.
- **Android**: same URL in Chrome → Install app.
- **Updates**: push to `main` → GitHub Actions builds → Pages serves → the installed app picks it up on next open (service worker autoUpdate).

## Build plan

- **Phase 1 — Kill the math**: Today screen (target + ring), food & meal library, manual entry + label-photo AI, check-off logging, automatic daily history. *→ planning drops from an hour to ~10 min.*
- **Phase 2 — Kill the planning**: start-from-yesterday, day templates, fill-the-gap suggestions, barcode scan, reminders ("plan your day" AM, "log dinner" PM). *→ under 3 minutes/day.*
- **Phase 3 — Delight**: dietitian PDF export, weekly insights, cloud backup, companion view for Justin.

## Design language

- Palette: leaf green `#2E7B45` (primary/eaten), light leaf `#A9CDB4` (planned), berry `#BE3D66` (fill-the-gap accent), amber `#D9A441` ("close" days only), warm paper `#FCFCF9`
- Big type, thumb-height controls, grams always visible with tabular numerals
- Tone: encouraging, zero-guilt. Celebrates streaks and overshooting the floor; a missed day is just a grey dot

## Open questions — resolved (July 2026)

1. Her phone: **iPhone**; standalone non-App-Store install strongly preferred → PWA.
2. Daily target: **she sets it herself**, changes rarely → target carries forward day to day, editable from the Today chip (which also updates the forward default).
3. Staples: seeded starter library + **the app learns her habits** (usage counts, recency, learned slot preferences drive fill-the-gap). Home Chef meals matter — recipe-card scan + link import both supported; stored as single foods, brand "Home Chef", serving "1 serving".
4. Name: **Fibi** confirmed.
5. Hosting: **GitHub Pages, public repo, free plan** (confirmed fine — no personal data in code).
