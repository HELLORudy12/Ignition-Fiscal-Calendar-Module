# FiscalCalendarSelector: How It Works (conversion reference)

Source: Perspective project export `Fiscal.zip`, folder
`TemplateViews/Comon Elements/FiscalCalendarSelector`, plus an example `periodCalendar` dataset.
Goal: replace this set of nested views with a single Perspective component in a custom
Ignition 8.3 module. This document describes current behavior; no code yet.

---

## 1. What it is

A PowerBI-style fiscal time picker. The user picks a **fiscal period, week, or day**
(optionally a contiguous multi-item range), and the picker reports back a
`start` / `end` datetime pair plus a human-readable `name` (for example `W5-P2-2024`).
Year selection is intentionally disabled because the generated structures got too large.

It is built from six Perspective views that nest via Accordions and Flex Repeaters.
All communication back to the host is via **page-scoped messages**.

```
Host view (ExampleView)             holds start / end / name; handler: buttonPressedTimeSelector
└── TimeSelectionBox                entry point; tag-binds periodCalendar, builds weeksAndPeriods
    └── Accordion: one item per fiscal year ("Y2024", "Y2025", ...)
        └── PeriodBox               (one per year)
            ├── weekToggled = true  → Accordion: header = SelectionButton(period), body = WeekBox
            │   └── WeekBox         (one per period)
            │       ├── dayToggled = false → FlexRepeater of SelectionButton(week)
            │       └── dayToggled = true  → Accordion: header = SelectionButton(week), body = DayBox
            │           └── DayBox  (one per week) → FlexRepeater of 7 SelectionButton(day)
            └── weekToggled = false → FlexRepeater of SelectionButton(period) only
```

`SelectionButton` is the only view with real behavior. Every other view just slices the
nested calendar structure and passes it down.

---

## 2. Input format

### 2.1 The `periodCalendar` dataset

Currently tag-bound in `TimeSelectionBox.custom.periodCalendar` to
`[MQTT Engine]Edge Nodes/Central/Master Data/Tables/FlowersPeriodCalender` (direct mode,
fallbackDelay 2.5). **One row per fiscal week.**

| Column   | Type    | Meaning                                              |
|----------|---------|------------------------------------------------------|
| `FYWeek` | Integer | Week number within the fiscal year (1..52, or 53)    |
| `wStart` | Date    | Week start (inclusive)                               |
| `wEnd`   | Date    | Week end (**exclusive**, equals next week's `wStart`)|
| `FyYear` | Integer | Fiscal year                                          |
| `Period` | Integer | Fiscal period (1..13)                                |
| `pStart` | Date    | Period start (inclusive), repeated on every week row |
| `pEnd`   | Date    | Period end (**exclusive**), repeated on every week row |

Facts from the example (157 rows, FY2024 to FY2026):

- 52-week years, with a 53-week year in FY2025 (week 53 lands in period 13).
- 13 periods of 4 weeks; period 13 gets 5 weeks in a 53-week year.
- Fiscal weeks start Sunday. The fiscal year does not align with the calendar year
  (FY2025 runs 2024-12-29 to 2026-01-04).
- All timestamps are **local midnight, US Eastern** (05:00 UTC in winter, 04:00 UTC in
  summer). Boundaries shift with DST, so day math must be calendar-day math in the
  gateway/session time zone, never `+ 86,400,000 ms`.
- Rows are in chronological order, but the code does not rely on that; it sorts keys.

### 2.2 Derived structure: `weeksAndPeriods`

`TimeSelectionBox.custom.weeksAndPeriods` is a property binding on `periodCalendar` with a
script transform that builds a nested dict keyed by string prefixes:

```
{
  "Y2024": {
    "P1": {
      "period": 1,
      "start": <pStart>,
      "end":   <pEnd>,
      "weeks": {
        "W1": {
          "week":  1,
          "start": <wStart>,
          "end":   <wEnd>,
          "days": {
            "D1": { "day": 1, "start": <wStart + 0d>, "end": <wStart + 1d> },
            ...
            "D7": { "day": 7, "start": <wStart + 6d>, "end": <wStart + 7d> }
          }
        },
        "W2": { ... "days": { "D8": ..., "D14": ... } }
      }
    },
    "P2": { ... }
  },
  "Y2025": { ... }
}
```

Details that matter for a faithful port:

- Days are generated, not read: 7 per week via `system.date.addDays(wStart, j)`.
- **Day numbers run across the whole fiscal year** (D1..D364, or D371), resetting per year.
- Keys are strings (`"Y2024"`, `"P3"`, `"W11"`, `"D71"`); every level sorts by the integer after
  the prefix.
- Older copies of this transform (in `ExampleView.custom.Test`) stored days as bare dates
  instead of `{day, start, end}` objects. The current shape is the one above.

### 2.3 Initial selection input

The host passes `start` and `end` params into `TimeSelectionBox`, which pass down unchanged as
`initialStart` / `initialEnd`. They control:

- **Auto-expansion.** The year whose key matches `getYear(end)` expands. A period expands if
  both `initialStart` and `initialEnd` fall inside it. A week expands under the same rule
  when `dayToggled` is on.
- **Auto-check on startup** (SelectionButton `onStartup`):
  - exact match (`item.start == start and item.end == end`) → checked
  - with `multi` on: items lying inside `[start, end]` also get checked (week/period test
    nudges edges by ±1 day; day test checks `day.end` is between)

---

## 3. Output

### 3.1 Primary output: message `buttonPressedTimeSelector`

Sent by SelectionButton with `scope='page'`. Payload:

```
{ "start": <Date>, "end": <Date>, "name": <string> }
```

Receivers:

- `TimeSelectionBox` root handler → writes `custom.selectedStart`, `custom.selectedEnd`,
  `custom.selectedName`.
- The **host view** must have its own copy of the handler (per the view documentation). In
  `ExampleView` it writes `custom.start`, `custom.end`, `custom.name`, then pulses
  `custom.updating` True → False to retrigger the `custom.selected` binding.

`end` is exclusive, matching the dataset (a period's `end` is the next period's start).

### 3.2 Name format

Built in SelectionButton `onActionPerformed`. The year is `system.date.getYear(item.end)`,
the **calendar year of the end date** (see Quirks).

| Type   | Format                            | Example             |
|--------|-----------------------------------|---------------------|
| Period | `P{period}-{year}`                | `P10-2020`          |
| Week   | `W{week}-{periodKey}-{year}`      | `W40-P10-2020`      |
| Day    | `D{day}-{weekKey}-{periodKey}-{year}` | `D1-W1-P1-2018` |

`periodKey` and `weekKey` are the dict keys (`"P10"`, `"W1"`), so they already carry the prefix.
Multi-select ranges join names with `|` in chronological order, e.g.
`W5-P2-2024|W6-P2-2024|W7-P2-2024`.

### 3.3 Internal messages (button to button)

| Message                       | Scope | Payload              | Purpose |
|-------------------------------|-------|----------------------|---------|
| `setPreviousTime`             | page (default) | `{start, end, name}` | Every SelectionButton copies the current range into `custom.previousStart/End/Name` |
| `turnOffButtonsTimeSelector`  | page  | `{clear: bool}`      | Every SelectionButton decides whether to uncheck itself |

In practice the "current selection" lives in **every button's** `previous*` custom props,
kept in sync by broadcast.

### 3.4 Host-side consumption (ExampleView)

- Dropdown-style Button shows `custom.name` (shows "Select.." if the name parses as a
  `MM/dd/yy` date).
- The Button `onActionPerformed` opens a modal toggle popup of
  `TemplateViews/MISS/TimeSelector/TimeSelectionBox` with `{start, end}`. That is an old path;
  the view also has an inline EmbeddedView pointing at the current path.
- `custom.selected` reverse-looks-up the range in `weeksAndPeriods` and returns
  `P{n}-{year}`, `W{n}-P{n}-{year}`, a `MM/dd/YY` date for single days, or `"No Data"`.

---

## 4. Selection behavior (SelectionButton)

Each button knows its `type` (`period` / `week` / `day`) and its own item
`{start, end, ...}`. On click:

1. Compute this item's `dateStart`, `dateEnd`, `name`.
2. **Chaining** (only if `multi`):
   - if `previousStart == dateEnd` → item attaches before: `start = dateStart`,
     `end = previousEnd`, `name = "{name}|{previousName}"`
   - elif `previousEnd == dateStart` → item attaches after: `start = previousStart`,
     `end = dateEnd`, `name = "{previousName}|{name}"`
   - else → range is just this item.
3. **If the button was already checked (deselect):**
   - uncheck the icon
   - if `start == previousStart` → trim the front: send range `[end, previousEnd]`
   - elif `end == previousEnd` → trim the back: send range `[previousStart, start]`
   - else (item in the middle) → send `turnOffButtonsTimeSelector {clear: true}`, which
     unchecks everything
4. **If unchecked (select):** check the icon, send `buttonPressedTimeSelector` and
   `setPreviousTime` with the computed range, set `toggled = justToggled = true`, then send
   `turnOffButtonsTimeSelector {clear: false}`.
5. **Receiving `turnOffButtonsTimeSelector`:** each button stays checked if it just toggled
   (`justToggled`, consumed and reset here) or if `multi` is on, `clear` is false, and its own
   `end` falls inside `[previousStart, previousEnd]`. Otherwise it unchecks.

Net effect:

- **Single mode:** clicking any item selects exactly that item; all others uncheck.
- **Multi mode:** only a contiguous, adjacent extension is possible. Clicking a
  non-adjacent item starts a new range and unchecks the rest. Ranges can mix types (a
  period followed by the adjacent week), since only boundaries are compared.
- Tooltip on each button: `MM/dd/yy-MM/dd/yy` of its start/end.

---

## 5. Params and custom properties → proposed component props

Everything below comes from the six views. The "Proposed prop" column is a suggested
component prop path. Items marked *internal* are view plumbing that a single component
replaces. They're still listed so every one is accounted for, and they can be exposed if
you want visibility for debugging.

### 5.1 TimeSelectionBox (entry point)

| Source                     | Dir    | Type    | Example / default | Proposed prop |
|----------------------------|--------|---------|-------------------|---------------|
| `params.start`             | input  | Date    | 2020-09-13        | `props.start` (initial / current range start, bidirectional) |
| `params.end`               | input  | Date    | 2020-10-04        | `props.end` (bidirectional) |
| `params.multi`             | input  | Boolean | false             | `props.multi` |
| `params.weekToggled`       | input  | Boolean | true              | `props.weekToggled` (show weeks under periods) |
| `params.dayToggled`        | input  | Boolean | false             | `props.dayToggled` (show days under weeks) |
| `custom.periodCalendar`    | —      | Dataset | tag binding       | `props.periodCalendar` (user binds it; no hardcoded tag) |
| `custom.weeksAndPeriods`   | —      | Object  | derived tree      | `props.weeksAndPeriods` (derived, read-only output; optional) |
| `custom.selectedStart`     | —      | Date    | —                 | `props.selectedStart` (output) |
| `custom.selectedEnd`       | —      | Date    | —                 | `props.selectedEnd` (output) |
| `custom.selectedName`      | —      | String  | `W40-P10-2020`    | `props.selectedName` (output) |
| `custom.path`              | —      | String  | view folder path  | *internal*, obsolete in a component |

### 5.2 PeriodBox / WeekBox / DayBox (pass-through layers)

| Source                         | Dir    | Type    | Proposed prop |
|--------------------------------|--------|---------|---------------|
| `PeriodBox.params.periods`     | input  | Object  | *internal*: one year's slice of `weeksAndPeriods` |
| `WeekBox.params.weeks`         | input  | Object  | *internal*: one period's `weeks` |
| `WeekBox.params.period`        | input  | String  | *internal*: period key (`"P2"`), used in names |
| `DayBox.params.days`           | input  | Object  | *internal*: one week's `days` |
| `DayBox.params.week` / `.period` | input | String | *internal*: keys used in day names |
| `*.params.initialStart/End`    | input (PeriodBox: inout) | Date | same as `props.start` / `props.end` |
| `*.params.multi`, `dayToggled`, `weekToggled` | input | Boolean | same as top-level props |
| `*.params.path`                | input  | String  | *internal*, obsolete |

### 5.3 SelectionButton (per item state)

| Source                  | Dir    | Type    | Proposed prop |
|-------------------------|--------|---------|---------------|
| `params.type`           | input  | String  | *internal*: `period`/`week`/`day` per rendered node |
| `params.name`           | input  | String  | *internal*: node label (`P3`, `W11`, `D71`) |
| `params.period` / `week` / `day` | input | Object/String | *internal*: node data |
| `params.initialStart/End`, `params.multi` | input | — | top-level props |
| `custom.toggled`        | —      | Boolean | `props.selectedKeys` (array of checked node keys, e.g. `Y2024/P2/W5`) |
| `custom.justToggled`    | —      | Boolean | *internal*: sequencing flag, not needed with central state |
| `custom.previousStart`  | —      | Date    | same value as `props.selectedStart` |
| `custom.previousEnd`    | —      | Date    | same value as `props.selectedEnd` |
| `custom.previousName`   | —      | String  | same value as `props.selectedName` |
| `custom.setStart` / `setEnd` | — | —       | unused (declared, never read) |

### 5.4 ExampleView (host side, for reference)

| Source            | Meaning                              | Component equivalent |
|-------------------|--------------------------------------|----------------------|
| `custom.start/end/name` | range received from the message | bind to `props.selectedStart/End/Name` |
| `custom.updating` | pulse used to retrigger `selected`   | not needed: bindings update directly |
| `custom.selected` | reverse lookup label or `"No Data"`  | `props.selectedName` |
| `custom.Test`     | old copy of the tree transform       | drop |

### 5.5 Suggested component surface (summary)

- **Inputs:** `periodCalendar` (Dataset), `start`, `end`, `multi`, `weekToggled`, `dayToggled`
- **Outputs (written by the component):** `selectedStart`, `selectedEnd`, `selectedName`,
  `selectedKeys`, optional `weeksAndPeriods`
- **Component event:** `onSelectionChange` with `{start, end, name}`, replacing the need
  to copy a message handler into every host view
- Optionally, keep sending `buttonPressedTimeSelector` as a compatibility mode so existing
  host views keep working during migration.

---

## 6. Quirks and bugs to fix during conversion

1. **Year in names and lookups is the calendar year of `end`, not `FyYear`.** FY2025 P13
   (ends 2026-01-04) is named `P13-2026`, and year auto-expansion plus `ExampleView.selected`
   look in the wrong year near year boundaries. Use `FyYear`.
2. **Deselecting an edge produces an empty name.** The trim logic splits the *clicked
   item's* name instead of `previousName`, so the result is `""`.
3. **Deselecting the only selected item** (or any item in single mode) sends a zero-length
   range (`start == end`) with an empty name, instead of clearing.
4. **Middle deselect clears the checkboxes but never tells the host.** No
   `buttonPressedTimeSelector` is sent, so the host keeps the stale range.
5. **Page-scoped messages cross-talk.** Two selectors on one page will uncheck each other
   and both hosts receive both selectors' output. A component with its own state avoids this.
6. **Selection state lives only in button views.** The checkmarks re-derive from the
   *initial* params on startup, so a re-rendered accordion body can show the original range
   instead of the current one.
7. **Tree build is O(n²):** `for year in years` runs once per row and rebuilds the same year
   repeatedly. Group once.
8. **Timezone and DST:** keep day generation as calendar-day math in the session/gateway
   zone. Ship dates to the browser as epoch millis and compare instants, not formatted strings.
9. **Hardcoded tag path** in `TimeSelectionBox.custom.periodCalendar`. It becomes a prop the
   user binds.
10. The Accordion transform in TimeSelectionBox wraps everything in `try/except: pass`,
    so a malformed dataset renders silently empty. The component should validate required
    columns and show an error state.
11. The ExampleView popup points at a stale path (`TemplateViews/MISS/TimeSelector/...`).

---

## 7. Notes for the module design

- **Where the logic runs.** Build the year → period → week → day tree once from the dataset,
  either gateway-side in Java when the prop changes, or client-side in TypeScript from the
  dataset prop. Client-side keeps the gateway simple; the example is only about 160 rows
  per 3 years. It expands to about 1,100 day nodes, which is fine for a lazily-rendered tree.
- **Selection model.** Keep one `{start, end}` range plus an ordered list of selected node
  keys in the component's state. Checked state is then derived: a node is checked if it
  lies inside the range (multi) or equals it (single). This removes the broadcast messages
  and the `justToggled` sequencing.
- **Keep behavior compatible:** exclusive `end`, the `|`-joined names, the
  `weekToggled`/`dayToggled` switches, and the auto-expand/auto-check rules from 2.3.
- **Year-level selection** is off today. Design the node model so a year node is just
  another selectable level that can be enabled later with a prop (`yearToggled`).
