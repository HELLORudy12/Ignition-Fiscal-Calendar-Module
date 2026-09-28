# Fiscal Calendar: project writeup

Context that can't be read from the code: where this came from, why things are the way they are, environment gotchas,
what has and hasn't been verified, and what's still open. Written 2026-09-28.

For what the component does and how to build it, see [README.md](README.md). For the original view-based selector this
replaces (its behavior, input format and bugs), see
[docs/FiscalCalendarSelector-writeup.md](docs/FiscalCalendarSelector-writeup.md). Section and quirk numbers below
("writeup 2.3", "quirk 4") refer to that document.

---

## 1. History

1. **Getting a module to install at all.** Started with IA's `perspective-component-minimal` example
   (`ignition-sdk-examples`, branch `ignition-8.3`). It built, but the gateway refused to load it:
   `ModuleLoadException: Not eligible for use with Ignition Maker Edition`. The gateway is **Maker Edition**, so
   every gateway hook must override `isMakerEditionCompatible()` to return `true`. There is no build or `module.xml`
   setting for this; the hook method is the only switch.
2. **Building in the full example.** Moved to IA's `perspective-component` example (the RadComponents module with
   Image, Messenger and TagCounter) because it shows more of the API: events, output props, a props schema, SCSS.
   The FiscalCalendarSelector was built inside it.
3. **Splitting out.** Copied to this standalone repo with fresh git history, the three example components removed,
   and everything renamed from `org.fakester` / RadComponents to `com.chaffin.fiscal` / Fiscal Calendar.

The component went through three UI designs, in order: nested buttons (like the original views), then rows with
checkboxes, then the current dropdown box with a popup panel.

---

## 2. Environment and build gotchas

- **JDK 17 only.** This machine's default `java` is JDK 25, which Gradle 8.2.1 can't run (the build fails with just
  `25.0.3`). Set `JAVA_HOME` first. On the original machine: `C:\Users\drwho\.jdks\ms-17.0.20.1`.
- **Always `.\gradlew clean build`.** With the module plugin (`io.ia.sdk.modl` 0.1.1), a plain `build` once packed a
  stale `common` jar into the `.modl`, even though `common\build\libs` held the fresh one. The gateway then threw
  `NoClassDefFoundError` for a newly added class. If the gateway reports a missing class, open the `.modl` (it's a zip)
  and check its jars before debugging code.
- **`clean` can fail with "Unable to delete directory ...\web\build"** if a shell or program has its working
  directory inside `web\build`. Close it and retry.
- **Unsigned modules.** The build skips signing (`skipModlSigning`). The gateway needs
  `-Dignition.allowunsignedmodules=true` as the next `wrapper.java.additional.N` in `data\ignition.conf`, then a
  restart.
- **What needs a restart after reinstalling:**
  - TypeScript/SCSS-only change: refresh the Perspective session.
  - Java or props-schema (`*.props.json`) change: restart the Designer.
- **The component doesn't open in Designer design mode**, by design (same as the built-in Dropdown). Use preview mode
  or a session.
- **Optional later:** `-Dia.developer.moduleupload=true` in `ignition.conf` lets Gradle deploy straight to the gateway
  (`hostGateway` in the `ignitionModule` block). For Java debugging, add a JDWP agent to `ignition.conf` and attach
  IntelliJ's "Remote JVM Debug".

---

## 3. Design decisions

### Where the logic lives

Everything except registration is **TypeScript in the browser**. The Java side only declares and registers the
component. Building the tree client-side was fine at this data size: about 160 rows for 3 years, about 1,100 day
nodes. Building it on the gateway was considered (writeup section 7) and not needed.

### No message handlers (decided)

The original views talked to hosts through page-scoped messages (`buttonPressedTimeSelector` etc.). The module
**deliberately doesn't send or receive any messages**; the decision was to keep everything inside the component.
Hosts either bind to the output props (`selectedStart` / `selectedEnd` / `selectedName` / `selectedKeys`) or use the
`onSelectionChange` event. A "compatibility mode" that also sent the old message was considered and rejected. It would
need Java (a gateway model delegate) and isn't wanted.

### Selection model

- One central selection `{start, end, names[], keys[]}` in component state replaces the per-button `previous*`
  props and the broadcast messages. Checked state is **derived** from it, not stored per item. This fixes quirks 5
  (two selectors on a page interfering) and 6 (checkmarks re-deriving from stale initial params).
- `keys` and `names` are parallel arrays, so removing the first or last item trims both. This fixes quirk 2
  (deselecting an edge lost the names).
- Deselecting the only item, or a middle item, clears the selection and reports the clear (quirks 3 and 4).
- **Decision not in the original:** in multi mode, clicking an item that's checked only because it sits inside a
  selected parent (e.g. a week inside a selected period) *narrows* the selection to that item, instead of clearing
  everything.
- Names use the **fiscal year**, not the calendar year of the end date (quirk 1). `FY2025 P13` is `P13-2025`, not
  `P13-2026`.
- Year nodes exist in the tree but are only selectable with `yearToggled`. Their name, `FY2025`, is our own choice;
  the original never allowed year selection.

### Initial selection from `start` / `end`

- Applied once the calendar has loaded (the tag binding often arrives after mount), and again whenever `start`/`end`
  change. `selectionFromRange()` looks for a run of items at one level that covers the range exactly, trying periods
  first, then weeks, then days.
- At runtime it **writes the output props** so a host bound to `selectedName` shows the initial range immediately.
- It **does not fire `onSelectionChange`** (only user clicks do), and **doesn't write in Designer design mode**,
  because writes there would change the saved view.

### Dates

- Everything internal is **epoch milliseconds**; compare numbers, never formatted strings (quirk 8).
- **Output dates are epoch millis**, not date objects. Chosen for predictability. Hosts use `toDate()` in bindings.
  Not yet checked how they look in the Designer; changing it is one spot in `writeOutputs()`.
- **Day boundaries** use calendar-day math in the browser's local time and keep `wStart`'s time of day:
  `new Date(y, m, d + j, h, min)`. Adding `j * 86400000` would be an hour off after DST changes. Keeping the time of
  day, rather than forcing midnight, keeps days lined up with the data's week boundaries even if a browser isn't in
  the gateway's time zone. The data is US Eastern local midnights.
- `end` is always exclusive, matching the dataset. Row date labels show the last day as `end` minus one day.

### Dropdown / popup

- The popup is rendered with a **React portal into `document.body`**, like Perspective's own dropdowns, so containers
  with hidden overflow can't clip it. Consequences:
  - Its styles can't be nested under the component's root class. They live under `.fcs-popup` in the SCSS.
  - Clicks in the popup would bubble (through the portal) to the component root and fire any mouse events configured
    on it, so the popup stops propagation.
  - Outside-click detection checks both the box element and the popup element.
- The root element never sets its own `ref`; Perspective passes one via `emit()`. Use `this.props.store.element` to
  get the DOM node.
- **`label` is an input** (text override for the box), not an output. Empty `label` shows the selected name, or the
  placeholder.
- `placeholder` follows the Dropdown's `{text, color}` shape but **has no icon** (Ignition's supports one).
- `dropdownStyle` is read with `tree.readStyle('dropdownStyle').toStyleProps()`. That's the client API that turns an
  Ignition style object, including style classes, into `className` + `style` for any element.
- Single mode closes the popup after a pick. Multi mode stays open.

### Look

- Clean and borderless: soft grey hover, light blue tint when selected, rotating chevrons, custom checkbox, and a
  muted date range on each row.
- Colors: `#7a7a7a` grey and the IA blue `#1a73e8` (via `--callToAction`), plus the same two at low opacity for tints.
- Theme variables with fallbacks (`--border`, `--input`, `--neutral-10`, `--neutral-90`, `--callToAction`,
  `--error`). The names are a best guess at Perspective's theme variables and haven't been checked against 8.3.
  Worst case is a slightly off shade in dark themes.

### Palette category `input`

The Designer groups palette entries by the category string and capitalizes it for display
(`StringUtils.capitalize` in `ListCategoryView`), so `input` should merge into the built-in **Input** group. This was
inferred from the Designer's bytecode, not confirmed in a running Designer. Fallback if it shows as a separate group:
`MattInputs`.

---

## 4. Verified vs. not verified

**Verified** (on 2026-09-28):
- The module builds cleanly, and the `.modl` contains the right ID, hooks, classes and web bundles.
- The tree and selection logic pass node tests against `sampleCalendarRows()`: a synthetic FY2024–FY2026 calendar
  (157 rows, 53-week FY2025) fed in reverse order. The tests covered:
  - day numbering (364/371/364)
  - DST days (D71 in FY2025 is 23 hours)
  - single and multi select, prepend/append, and edge/middle/only deselects
  - narrowing
  - `selectionFromRange`
  - auto-expand
- `validateTree()` catches a deliberately broken week boundary.

**Not verified yet** (needs a running gateway):
- The component on a real gateway after the split: palette placement, rendering, the popup, theme colors.
- Behavior against the real `FlowersPeriodCalender` tag data. Watch the browser console for
  `FiscalCalendarSelector:` warnings from `validateTree()`.
- How output millis look in the Designer and in host bindings.
- The Perspective client APIs used (`readDataset`, `readStyle`, `store.props.write`, `fireComponentEvent`,
  `ReactDOM.createPortal`) compile against the SDK typings, but haven't all been exercised in a session.

### Re-running the logic tests

The tests are the exported `sampleCalendarRows()` and `validateTree()` in `fiscal/calendar.ts`. From `web\`, after one
build has downloaded Node:

```powershell
$node = ".\.gradle\nodejs\node-v16.15.0-win-x64\node.exe"
& $node node_modules\typescript\bin\tsc packages\client\typescript\fiscal\selection.ts --outDir $env:TEMP\fcs --target es6 --module commonjs --skipLibCheck
$env:TZ = "America/New_York"
& $node -e "const c = require(process.env.TEMP + '/fcs/calendar.js'); const t = c.buildTree(c.sampleCalendarRows()); console.log(t.length, 'years', c.validateTree(t));"
```

It should print `3 years []`. Compiling `selection.ts` also compiles `calendar.ts`, so `selection.js` can be required
the same way to try click sequences with `applyClick()`.

---

## 5. Migration notes (Ignition side)

- **Uninstall RadComponents** from the gateway before installing this module. The module ID changed, so both would
  load side by side.
- **Re-add the component to views.** The component ID changed from `rad.input.fiscalcalendarselector` to
  `chaffin.input.fiscalcalendarselector`, so views that used the RadComponents version need it added again.
- In each host view that used the old nested views:
  - Remove the copied `buttonPressedTimeSelector` message handler.
  - Drop the `custom.updating` pulse and the `custom.selected` reverse lookup. Bind to `selectedName` instead.
  - Bind `periodCalendar` to the calendar tag, which was previously hardcoded (quirk 9).
  - Fix or replace the popup action pointing at the stale `TemplateViews/MISS/TimeSelector/...` path (quirk 11).

---

## 6. Open items and ideas

- **Git:** the repo was initialized with all files staged, but not committed; no git identity was set on the machine.
  The project is MIT-licensed (`LICENSE`, `license.html`, and the `package.json` `license` fields).
- `web/packages/designer` is an **empty placeholder**. Its bundle (`FiscalCalendarDesign.js`) is built but never loaded
  (no `BrowserResource` for it). Delete the package, or use it for designer-only UI later.
- The `.modl`'s `module.xml` says `<freeModule>false</freeModule>` while the gateway hook's `isFreeModule()` returns
  `true`. This was inherited from the example and hasn't caused problems.
- Possible additions: a placeholder icon, keyboard navigation inside the popup (arrow keys between rows), and real
  unit tests in the build instead of the manual node commands above.

---

## 7. Working conventions

- Prefer **laid-out, linear code** (explicit loops, named intermediate variables, a comment block listing the rules
  above each function) over dense chained or functional style. `fiscal/selection.ts` is the reference style.
- Keep behavior compatible with the original where it wasn't a bug: exclusive `end`, `|`-joined names, the
  `weekToggled` / `dayToggled` switches, and the auto-expand / auto-check rules.
