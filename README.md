# Fiscal Calendar

An Ignition 8.3 Perspective module that adds a **Fiscal Calendar Selector** component: a dropdown that opens a
fiscal year → period → week → day picker driven by a fiscal calendar dataset. It replaces a set of nested Perspective
views; see [docs/FiscalCalendarSelector-writeup.md](docs/FiscalCalendarSelector-writeup.md) for the original behavior
and the design notes, and [writeup.md](writeup.md) for project history, design decisions, and open items.

Started from Inductive Automation's `perspective-component` example
([ignition-sdk-examples](https://github.com/inductiveautomation/ignition-sdk-examples), branch `ignition-8.3`).

## Using the component

After installing the module, **Fiscal Calendar Selector** appears in the Designer's Perspective component palette under
**Input**.

| Prop | Purpose |
|---|---|
| `periodCalendar` | Dataset, one row per fiscal week: `FYWeek`, `wStart`, `wEnd`, `FyYear`, `Period`, `pStart`, `pEnd`. Bind it to your calendar tag. |
| `start`, `end` | Optional initial range (`end` exclusive). Checks and expands the matching items. |
| `multi` | Allow extending the selection to adjacent items. |
| `weekToggled`, `dayToggled`, `yearToggled` | Show weeks under periods, days under weeks, and make years selectable. |
| `label`, `placeholder` | Text in the dropdown box. Empty `label` shows the selected name, or the placeholder. |
| `showClearIcon`, `enabled` | Same as the standard Perspective Dropdown. |
| `style`, `dropdownStyle` | Style of the box and of the popup panel (standard Ignition style objects). |
| `selectedStart`, `selectedEnd` | Output: selected range as epoch millis (`end` exclusive). Use `toDate()` in bindings that need dates. |
| `selectedName`, `selectedKeys` | Output: e.g. `W5-P2-2024`, multi-item ranges joined with `\|`; and node keys like `Y2024/P2/W5`. |

The **`onSelectionChange`** component event fires on user changes with `event.start`, `event.end` and `event.name`.

## Building

Requires **JDK 17** (Gradle 8.2.1 doesn't run on newer JDKs). The Gradle wrapper downloads Node and Yarn for the web
build, so nothing else needs installing.

```powershell
$env:JAVA_HOME = "<path to JDK 17>"
.\gradlew clean build
```

Always use `clean build`: a plain `build` can pack stale jars into the module. The build writes a signed
`build\FiscalCalendar.modl` and an unsigned `build\FiscalCalendar.unsigned.modl`.

Install the signed `.modl` from the gateway web UI's Modules page and accept its certificate (`CN=Matt Chaffin`) when
asked. Restart the Designer completely after installing a build that changes Java code or the props schema.

### Signing

Signing uses a self-signed certificate. The `io.ia.sdk.modl` plugin reads these properties, which belong in your
user-level `~/.gradle/gradle.properties` (never in the repo):

```properties
ignition.signing.keystoreFile=C:/path/to/module-signing.pfx
ignition.signing.keystorePassword=...
ignition.signing.certFile=C:/path/to/module-signing.p7b
ignition.signing.certAlias=module-signing
ignition.signing.certPassword=...
```

A `.pfx` keystore is read as PKCS12; anything else as JKS. To build unsigned only (for example on a machine without the key), set `skipModlSigning.set(true)` in `build.gradle.kts`. Installing an unsigned module needs
`-Dignition.allowunsignedmodules=true` as the next `wrapper.java.additional.N` entry in `data\ignition.conf`.

To create a new key pair (JDK 17 `keytool`, plus `openssl` from Git Bash):

```sh
keytool -genkeypair -alias module-signing -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 3650 \
  -dname "CN=Your Name" -storetype PKCS12 -keystore module-signing.pfx
keytool -exportcert -rfc -alias module-signing -keystore module-signing.pfx -file module-signing.pem
openssl crl2pkcs7 -nocrl -certfile module-signing.pem -outform DER -out module-signing.p7b
```

Keep the same key for every release: a new key means users must accept a new certificate.

## Project layout

```
common/     Component descriptor (ID, palette entry, props schema, events) shared by gateway and designer
  src/main/resources/fiscalcalendarselector.props.json      props shown in the Designer property editor
gateway/    Gateway hook: registers the component and serves the web files at /res/fiscalcalendar/
designer/   Designer hook: adds the component to the palette
web/        TypeScript/React front end (a yarn workspace built by webpack)
  packages/client/typescript/components/FiscalCalendarSelector.tsx   the component (box, popup, rendering)
  packages/client/typescript/fiscal/calendar.ts                      dataset parsing, tree building, validation
  packages/client/typescript/fiscal/selection.ts                     naming and selection rules
  packages/client/scss/_fiscal-calendar-selector.scss                styles
  packages/designer/                                                 placeholder for designer-only code (not loaded)
docs/       Original writeup of the view-based selector this replaces
```

The component ID `chaffin.input.fiscalcalendarselector` must match between `FiscalCalendarSelector.java` and
`FiscalCalendarSelector.tsx`, and the module ID `com.chaffin.fiscal` between `build.gradle.kts` and
`FiscalCalendar.java`.
