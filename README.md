# Russian Grammar Drills

A small, offline-capable web app for drilling Russian grammatical constructions that are easy to recognize but hard to produce — particles like же, бы, and -то that have no clean English equivalent.

No build step, no dependencies, no framework. Static HTML, CSS, and vanilla ES modules, served over HTTP.

## Running

Serve the directory over HTTP:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.

The app will not work from `file://` — the content files are loaded via `fetch`, which browsers block on that scheme.

## Usage

The app presents one topic at a time. A topic is a set of example sentences grouped by function, each sentence given in Russian and English.

- **Category dropdown** — select which topic to drill.
- **Click any line** — hides or reveals that line. Useful for covering the Russian or the English and testing recall.
- **Show all / Hide all** — global controls for the current topic. Individual lines can still be toggled independently.
- **RU / EN** — switches the interface language. Does not affect which lines are currently revealed.

## Project layout

```
index.html                    entry point
assets/
  css/
    styles.css                app styles
    collapsible-panel.css     styles for the collapsible-section component
  js/
    app.js                    app entry point: fetching, rendering, event wiring
    i18n.js                   i18n mechanism (no strings; configured at boot)
    template-engine.js        placeholder substitution utility
    collapsible-panel.js      collapsible-section component
    strings/
      ui.js                   UI strings (static, authored)
data/
  index.json                  manifest: list of content filenames
  by.json                     частица «бы»
  zhe.json                    частица «же»
  indefinite-particles.json   частицы «-нибудь», «-то», «-кое»
  to-particle.json            частица «-то»
```

## Adding content

Grammar content lives in `data/`, one file per topic, listed in `data/index.json`.

To add a topic:

1. Create a new JSON file in `data/` with the shape documented below.
2. Add its filename to `data/index.json`.
3. Reload.

No code changes required. The data is validated at load time; malformed files fail loudly rather than degrading silently.

Filenames use Latin transliteration (`by.json`, not `бы.json`) because non-ASCII pathnames remain unreliable across tooling. The human-readable name lives inside the file.

### Data format

`data/index.json` is the manifest:

```json
{
  "categories": [
    "by.json",
    "zhe.json",
    "indefinite-particles.json",
    "to-particle.json"
  ]
}
```

Filenames are resolved relative to the manifest's directory.

Each content file has the following shape:

```json
{
  "id": "zhe",
  "name": { "ru": "Частица «же»", "en": "The particle «же»" },
  "sections": [
    {
      "id": "zhe.contrast",
      "name": { "ru": "Контраст и противопоставление", "en": "Contrast and opposition" },
      "entries": [
        { "id": "zhe.c.001", "ru": "Я же тебе говорил.", "en": "I told you, didn't I." }
      ]
    }
  ]
}
```

**Fields**

- `id` (string, required, non-empty) — a stable identifier for the content file. Must be unique across all files.
- `name` (object, required) — the file's display name, with a non-empty string for each supported UI language (`ru`, `en`).
- `sections` (array, required) — the file's sections.
  - `id` (string, required, non-empty) — must be unique within the file.
  - `name` (object, required) — the section's display name, with a non-empty string for each supported UI language.
  - `entries` (array, required) — the section's entries.
    - `id` (string, required, non-empty) — must be unique within the section.
    - `ru` (string, required, non-empty) — the Russian line.
    - `en` (string, required, non-empty) — the English line.

All ids are stable identifiers, not display text. Two consequences:

1. **Renaming a topic or section in the display name does not change its id.** Update the `name` field, leave the `id` field alone.
2. **Ids may contain dots** (as in `zhe.contrast`). This is safe as long as ids within the same parent don't form a prefix of each other. For example, `zhe.contrast` and `zhe.emphasis` may coexist; `zhe` and `zhe.contrast` may not, within the same file.

The validation performed at load time enforces all of the above. A malformed file produces a console error naming the offending path (e.g. `categories[1].sections[0].entries[3].ru must be a non-empty string.`) and the app fails to load rather than rendering partial content.

## Interface language

The UI supports Russian and English. The active language is not persisted across reloads; each session starts in Russian.

Content strings (topic names and section names) are derived from the loaded data and registered into the same i18n dictionary as the static UI strings. Consequently, adding a new topic to `data/` also adds its names to the language switcher's scope without any code changes.

## License

MIT — see LICENSE.
