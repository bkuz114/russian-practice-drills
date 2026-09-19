/**
 * app.js
 *
 * Entry point for the Russian grammar drills app. Loads grammar
 * content from a manifest, renders it, wires up controls, and
 * localizes UI and content through the i18n module.
 *
 * ──────────────────────────────────────────────────────────────────
 * Content data model
 * ──────────────────────────────────────────────────────────────────
 *
 * The app loads a manifest ("data/index.json") listing category
 * filenames. Each category file is a JSON object:
 *
 *   {
 *     id: string,                       // globally unique
 *     name: { ru: string, en: string },
 *     sections: [
 *       {
 *         id: string,                   // unique within the category
 *         name: { ru: string, en: string },
 *         entries: [
 *           {
 *             id: string,               // unique within the section
 *             ru: string,
 *             en: string,
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Adding a new category requires no changes to this file: add the
 * filename to the manifest, add the file, refresh.
 *
 * ──────────────────────────────────────────────────────────────────
 * Rendered DOM
 * ──────────────────────────────────────────────────────────────────
 *
 * Rendered DOM carries the following data attributes, mirroring the
 * ids in the loaded data:
 *
 *   - data-category-id on each category container.
 *   - data-section-id  on each section root.
 *   - data-entry-id    on each entry container.
 *   - data-entry-line  on each entry-line button.
 *   - data-entry-lang  on each entry-line button ("ru" or "en").
 *
 * Category ids are globally unique. Section ids are unique within a
 * category. Entry ids are unique within a section. No code in this
 * module relies on document order.
 *
 * ──────────────────────────────────────────────────────────────────
 * Content i18n keys
 * ──────────────────────────────────────────────────────────────────
 *
 * Category and section names are registered into the i18n dictionary
 * under the content namespace, keyed by id:
 *
 *   content.category.<categoryId>.name
 *   content.section.<sectionId>.name
 *
 * The keys are constructed by contentKeyForCategory() and
 * contentKeyForSection() — the only two places the scheme exists.
 * Registration and rendering both use these functions, so the scheme
 * cannot drift between the two.
 *
 * ──────────────────────────────────────────────────────────────────
 * UI regions
 * ──────────────────────────────────────────────────────────────────
 *
 * The app has two control regions:
 *
 *   - Header (.app-header): controls for the app itself. The
 *     category dropdown (which view to load) and the UI language
 *     buttons (what language the app is displayed in). These are
 *     independent of whether any content is loaded.
 *
 *   - Toolbar (.app-toolbar): controls for the views. The global
 *     show/hide toggles for entry lines. These operate on a loaded
 *     view and are meaningless without one.
 *
 * Design decision: the toolbar holds controls that operate on views.
 * When no view is accessible — i.e. the category dropdown is empty —
 * the toolbar is hidden, because there is nothing for its controls to
 * act on. The header is never hidden; its controls remain functional
 * regardless of content.
 *
 * If a future control does not operate on views, it does not belong
 * in the toolbar. The rule is: toolbar controls depend on views
 * existing; header controls do not.
 *
 * ──────────────────────────────────────────────────────────────────
 * State
 * ──────────────────────────────────────────────────────────────────
 *
 * The app has no module-level mutable state. Everything a function
 * needs is either passed as an argument or read from the DOM.
 *
 * The DOM is the source of truth for:
 *   - Which category is active: the value of #category-select.
 *   - Which views are accessible: the options in #category-select.
 *   - Which entry lines are revealed: the aria-pressed attribute on
 *     each entry-line button.
 *
 * The loaded grammar data is passed explicitly to the functions that
 * use it.
 *
 * ──────────────────────────────────────────────────────────────────
 * Failure policy
 * ──────────────────────────────────────────────────────────────────
 *
 * No silent returns, no fallback strings. Invariant violations throw
 * via fail(). A missing i18n key surfaces as a blank element and a
 * console error. Functions that encounter a legitimate "not yet
 * established" state — such as no category being selected — handle
 * the state explicitly rather than throwing.
 */

import {
    configure,
    registerStrings,
    getString,
    getCurrentLanguage,
    setLanguage,
    applyLanguage,
    startAutoLocalization,
} from "./i18n.js";

import {
    createCollapsiblePanel
} from "./collapsible-panel.js";

import {
    uiStrings
} from "./strings/ui.js";

/* =========================================================================
 * Constants
 * ========================================================================= */

const SUPPORTED_LANGUAGES = Object.freeze(["ru", "en"]);
const DEFAULT_LANGUAGE = "ru";
const MANIFEST_URL = "data/index.json";

/**
 * DOM selectors used by this module. All are required to exist in
 * index.html; a missing selector is a fatal configuration error.
 * @type {Object<string, string>}
 */
const SELECTORS = Object.freeze({
    main: "#app-main",
    status: "#status",
    toolbar: ".app-toolbar",
    categorySelect: "#category-select",
    toggleRu: "#toggle-ru",
    toggleEn: "#toggle-en",
    toggleRuLabel: "#toggle-ru-label",
    toggleEnLabel: "#toggle-en-label",
    langButton: "[data-ui-lang]",
});

/**
 * Data attribute names set on rendered elements. Referenced in both
 * the DOM-building code and the DOM-querying code so that the two
 * cannot disagree.
 * @type {Object<string, string>}
 */
const ATTR = Object.freeze({
    categoryId: "data-category-id",
    sectionId: "data-section-id",
    entryId: "data-entry-id",
    entryLine: "data-entry-line",
    entryLang: "data-entry-lang",
});

/**
 * CSS class applied to elements that should be hidden. Defined once so
 * that the JS side and the CSS side agree on the spelling.
 * @type {string}
 */
const CLASS_HIDDEN = "is-hidden";

/* =========================================================================
 * Failure
 * ========================================================================= */

/**
 * Throws an Error with a diagnostic message.
 *
 * @param {string} message - Description of the failure.
 * @throws {Error} Always.
 */
function fail(message) {
    throw new Error(`app: ${message}`);
}

/**
 * Returns a required element, throwing if it is missing or of the
 * wrong type. Use where the element is part of the app's contract
 * with index.html.
 *
 * @template {Element} T
 * @param {string} selector - CSS selector.
 * @param {Function} expectedType - Constructor the element must be an
 *     instance of.
 * @param {ParentNode} [root=document] - Root to query within.
 * @returns {T} The found element.
 * @throws {Error} If the element is missing or of the wrong type.
 */
function requireElement(selector, expectedType, root = document) {
    const element = root.querySelector(selector);
    if (element === null) {
        fail(`Required element "${selector}" not found.`);
    }
    if (!(element instanceof expectedType)) {
        fail(
            `Element "${selector}" is not an instance of ${expectedType.name}; ` +
            `received: ${Object.prototype.toString.call(element)}`
        );
    }
    return element;
}

/**
 * Returns all elements matching a selector, as an array. May be empty.
 *
 * @param {string} selector - CSS selector.
 * @param {ParentNode} [root=document] - Root to query within.
 * @returns {Element[]} Matching elements.
 */
function queryAll(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

/* =========================================================================
 * Fetching
 * ========================================================================= */

/**
 * Fetches JSON from a URL and returns the parsed value.
 *
 * @param {string} url - URL to fetch.
 * @returns {Promise<*>} The parsed JSON value.
 * @throws {Error} On fetch failure, non-OK HTTP status, or invalid JSON.
 */
async function fetchJson(url) {
    if (typeof url !== "string" || url.length === 0) {
        fail(`fetchJson expected a non-empty string URL, received: ${JSON.stringify(url)}`);
    }

    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        fail(`Network error while fetching "${url}": ${error.message}`);
    }

    if (!response.ok) {
        fail(`Fetching "${url}" returned HTTP ${response.status} ${response.statusText}.`);
    }

    try {
        return await response.json();
    } catch (error) {
        fail(`Response from "${url}" was not valid JSON: ${error.message}`);
    }
}

/**
 * Fetches and validates the category manifest.
 *
 * @param {string} url - Manifest URL.
 * @returns {Promise<string[]>} Category filenames relative to the
 *     manifest's directory.
 * @throws {Error} If the manifest is missing, malformed, or lists
 *     non-string entries.
 */
async function fetchManifest(url) {
    const manifest = await fetchJson(url);

    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
        fail(`Manifest "${url}" must be a JSON object with a "categories" array.`);
    }
    if (!Array.isArray(manifest.categories)) {
        fail(`Manifest "${url}".categories must be an array of filenames.`);
    }
    for (let i = 0; i < manifest.categories.length; i++) {
        const entry = manifest.categories[i];
        if (typeof entry !== "string" || entry.length === 0) {
            fail(
                `Manifest "${url}".categories[${i}] must be a non-empty filename string, ` +
                `received: ${JSON.stringify(entry)}.`
            );
        }
    }

    return manifest.categories;
}

/**
 * Loads all grammar data: manifest, then each category file in
 * parallel. Returns a validated { categories: [...] } object.
 *
 * @param {string} manifestUrl - URL of the manifest.
 * @returns {Promise<Object>} The validated grammar data.
 * @throws {Error} If the manifest or any category file fails to load,
 *     or if the assembled data fails validation.
 */
async function fetchData(manifestUrl) {
    if (window.location.protocol === "file:") {
        fail(getString("status.serveOverHttp"));
    }

    const filenames = await fetchManifest(manifestUrl);
    const baseDir = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);

    const categories = await Promise.all(
        filenames.map((filename) => fetchJson(baseDir + filename))
    );

    const data = {
        categories
    };
    validateData(data);
    return data;
}

/* =========================================================================
 * Validation
 * ========================================================================= */

/**
 * Validates the shape of loaded grammar data. Throws on any violation,
 * with a path identifying where the problem is.
 *
 * @param {*} data - Candidate data object.
 * @throws {Error} If the data does not conform to the expected shape.
 */
function validateData(data) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        fail(`Data must be an object with a "categories" array. Received: ${Object.prototype.toString.call(data)}`);
    }
    if (!Array.isArray(data.categories)) {
        fail(`Data.categories must be an array. Received: ${Object.prototype.toString.call(data.categories)}`);
    }

    const seenCategoryIds = new Set();

    data.categories.forEach((category, ci) => {
        const path = `categories[${ci}]`;

        if (typeof category !== "object" || category === null) {
            fail(`${path} must be an object.`);
        }
        if (typeof category.id !== "string" || category.id.length === 0) {
            fail(`${path}.id must be a non-empty string.`);
        }
        if (seenCategoryIds.has(category.id)) {
            fail(`${path}.id "${category.id}" is duplicated.`);
        }
        seenCategoryIds.add(category.id);

        validateBilingualName(category.name, `${path}.name`);

        if (!Array.isArray(category.sections)) {
            fail(`${path}.sections must be an array.`);
        }

        const seenSectionIds = new Set();

        category.sections.forEach((section, si) => {
            const sPath = `${path}.sections[${si}]`;

            if (typeof section.id !== "string" || section.id.length === 0) {
                fail(`${sPath}.id must be a non-empty string.`);
            }
            if (seenSectionIds.has(section.id)) {
                fail(`${sPath}.id "${section.id}" is duplicated within category "${category.id}".`);
            }
            seenSectionIds.add(section.id);

            validateBilingualName(section.name, `${sPath}.name`);

            if (!Array.isArray(section.entries)) {
                fail(`${sPath}.entries must be an array.`);
            }

            const seenEntryIds = new Set();

            section.entries.forEach((entry, ei) => {
                const ePath = `${sPath}.entries[${ei}]`;

                if (typeof entry.id !== "string" || entry.id.length === 0) {
                    fail(`${ePath}.id must be a non-empty string.`);
                }
                if (seenEntryIds.has(entry.id)) {
                    fail(`${ePath}.id "${entry.id}" is duplicated within section "${section.id}".`);
                }
                seenEntryIds.add(entry.id);

                if (typeof entry.ru !== "string" || entry.ru.length === 0) {
                    fail(`${ePath}.ru must be a non-empty string.`);
                }
                if (typeof entry.en !== "string" || entry.en.length === 0) {
                    fail(`${ePath}.en must be a non-empty string.`);
                }
            });
        });
    });
}

/**
 * Validates a bilingual name object: a plain object with a non-empty
 * string for each supported language.
 *
 * @param {*} name - Candidate object.
 * @param {string} path - Path for diagnostics.
 * @throws {Error} If the object does not conform.
 */
function validateBilingualName(name, path) {
    if (typeof name !== "object" || name === null) {
        fail(`${path} must be an object with language keys.`);
    }
    for (const lang of SUPPORTED_LANGUAGES) {
        if (typeof name[lang] !== "string" || name[lang].length === 0) {
            fail(`${path}.${lang} must be a non-empty string.`);
        }
    }
}

/* =========================================================================
 * Content i18n
 * ========================================================================= */

/**
 * Returns the i18n key for a category's name.
 *
 * @param {string} categoryId - Category id.
 * @returns {string} The i18n key.
 */
function contentKeyForCategory(categoryId) {
    return `content.category.${categoryId}.name`;
}

/**
 * Returns the i18n key for a section's name.
 *
 * @param {string} sectionId - Section id.
 * @returns {string} The i18n key.
 */
function contentKeyForSection(sectionId) {
    return `content.section.${sectionId}.name`;
}

/**
 * Registers all content strings (category and section names) from the
 * loaded data into the i18n dictionary, one language at a time.
 *
 * @param {Object} data - Validated grammar data.
 * @throws {Error} If a section id contains a dot-segment that collides
 *     with an existing key.
 */
function registerContentStrings(data) {
    for (const lang of SUPPORTED_LANGUAGES) {
        const table = {
            content: {
                category: {},
                section: {},
            },
        };

        for (const category of data.categories) {
            table.content.category[category.id] = {
                name: category.name[lang],
            };

            for (const section of category.sections) {
                insertDottedName(
                    table.content.section,
                    section.id,
                    section.name[lang]
                );
            }
        }

        registerStrings(lang, table);
    }
}

/**
 * Inserts a name into a nested object at the path given by a
 * dot-separated id, e.g. "zhe.contrast" nests under zhe → contrast.
 *
 * Exists because content ids may contain dots, while the i18n
 * dictionary is nested and getString() splits keys on dots. Inserting
 * a dotted id as a flat key would make it unreachable.
 *
 * @param {Object} root - Root object to insert into (mutated).
 * @param {string} dottedId - Id, possibly containing dots.
 * @param {string} name - The localized name.
 * @throws {Error} If the insertion collides with an existing value.
 */
function insertDottedName(root, dottedId, name) {
    const segments = dottedId.split(".");
    let current = root;

    for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        if (!(segment in current)) {
            current[segment] = {};
        } else if (typeof current[segment] !== "object" || current[segment] === null) {
            fail(
                `registerContentStrings: id segment "${segment}" of "${dottedId}" ` +
                `collides with an existing non-object value.`
            );
        }
        current = current[segment];
    }

    const leaf = segments[segments.length - 1];
    if (leaf === "") {
        fail(`registerContentStrings: id "${dottedId}" has an empty segment.`);
    }
    if (leaf in current) {
        fail(`registerContentStrings: id "${dottedId}" collides with an existing key.`);
    }
    current[leaf] = {
        name
    };
}

/* =========================================================================
 * Rendering
 * ========================================================================= */

/**
 * Builds a single entry-line button.
 *
 * @param {Object} entry - Entry object with id, ru, en.
 * @param {"ru"|"en"} lang - Which language this line represents.
 * @returns {HTMLButtonElement} The button element.
 */
function buildEntryLine(entry, lang) {
    const text = entry[lang];
    if (typeof text !== "string" || text.length === 0) {
        fail(`buildEntryLine: entry.${lang} must be a non-empty string for entry "${entry.id}".`);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = `entry__line entry__line--${lang}`;
    button.setAttribute(ATTR.entryLine, "");
    button.setAttribute(ATTR.entryLang, lang);
    button.setAttribute("lang", lang);
    button.setAttribute("aria-pressed", "true");
    button.textContent = text;

    return button;
}

/**
 * Builds an entry container with both language lines.
 *
 * @param {Object} entry - Entry object with id, ru, en.
 * @returns {HTMLDivElement} The entry container.
 */
function buildEntry(entry) {
    const wrapper = document.createElement("div");
    wrapper.className = "entry";
    wrapper.setAttribute(ATTR.entryId, entry.id);

    wrapper.appendChild(buildEntryLine(entry, "ru"));
    wrapper.appendChild(buildEntryLine(entry, "en"));

    return wrapper;
}

/**
 * Builds a collapsible section panel for a section object.
 *
 * @param {Object} section - Section object with id, name, entries.
 * @returns {HTMLElement} The section root element.
 */
function buildSection(section) {
    const header = document.createElement("span");
    header.className = "section__title";
    header.setAttribute("data-i18n", contentKeyForSection(section.id));

    const body = document.createElement("div");
    body.className = "section__body";

    for (const entry of section.entries) {
        body.appendChild(buildEntry(entry));
    }

    const panel = createCollapsiblePanel({
        header,
        content: body,
        startOpen: true,
        classNames: {
            root: ["section"],
            trigger: ["section__trigger"],
            content: ["section__content"],
            twistie: ["section__twistie"],
        },
    });

    panel.root.setAttribute(ATTR.sectionId, section.id);

    return panel.root;
}

/**
 * Builds a category container with all its sections. The container
 * starts hidden; showCategory() controls visibility.
 *
 * @param {Object} category - Category object with id, name, sections.
 * @returns {HTMLElement} The category container.
 */
function buildCategory(category) {
    const container = document.createElement("section");
    container.className = "category";
    container.setAttribute(ATTR.categoryId, category.id);
    container.hidden = true;

    const heading = document.createElement("h2");
    heading.className = "category__heading";
    heading.setAttribute("data-i18n", contentKeyForCategory(category.id));
    container.appendChild(heading);

    for (const section of category.sections) {
        container.appendChild(buildSection(section));
    }

    return container;
}

/**
 * Renders all categories into #app-main, replacing any existing
 * rendered categories. Localizes the new DOM immediately.
 *
 * An empty categories array is valid: the app renders no categories,
 * shows an empty-state message in the status element, and returns.
 *
 * @param {Object[]} categories - Validated category objects.
 */
function renderCategories(categories) {
    const main = requireElement(SELECTORS.main, HTMLElement);
    const status = requireElement(SELECTORS.status, HTMLElement);

    for (const existing of queryAll(`[${ATTR.categoryId}]`, main)) {
        existing.remove();
    }

    if (categories.length === 0) {
        status.textContent = getString("status.empty");
        status.hidden = false;
        return;
    }

    status.hidden = true;

    for (const category of categories) {
        main.appendChild(buildCategory(category));
    }

    applyLanguage(getCurrentLanguage(), main);
}

/**
 * Populates the category dropdown from the loaded categories. An empty
 * array leaves the dropdown with no options.
 *
 * @param {Object[]} categories - Validated category objects.
 */
function populateDropdown(categories) {
    const select = requireElement(SELECTORS.categorySelect, HTMLSelectElement);

    select.innerHTML = "";

    for (const category of categories) {
        const option = document.createElement("option");
        option.value = category.id;
        option.setAttribute("data-i18n", contentKeyForCategory(category.id));
        select.appendChild(option);
    }
}

/* =========================================================================
 * View state
 * ========================================================================= */

/**
 * Returns the ids of the views the user can currently access, in the
 * order they appear in the category dropdown.
 *
 * The dropdown is the source of truth: a view is accessible if it has
 * an option the user could select. This is distinct from "a category
 * container exists in the DOM," which could be true even if the
 * corresponding option were missing, disabled, or removed.
 *
 * The returned array is empty if no views are accessible.
 *
 * @returns {string[]} Accessible view ids.
 */
function accessibleViews() {
    const select = requireElement(SELECTORS.categorySelect, HTMLSelectElement);
    return Array.from(select.options).map((option) => option.value);
}

/**
 * Returns the id of the currently selected view, or null if none is
 * selected.
 *
 * @returns {?string} The selected view id, or null.
 */
function selectedViewId() {
    const select = requireElement(SELECTORS.categorySelect, HTMLSelectElement);
    return select.value === "" ? null : select.value;
}

/**
 * Shows the category container with the given id, hides all others.
 *
 * @param {string} categoryId - Category id to activate.
 * @throws {Error} If no container exists for the given id.
 */
function showCategory(categoryId) {
    const containers = queryAll(`[${ATTR.categoryId}]`);
    let found = false;

    for (const container of containers) {
        const id = container.getAttribute(ATTR.categoryId);
        const isTarget = id === categoryId;
        container.hidden = !isTarget;
        if (isTarget) {
            found = true;
        }
    }

    if (!found) {
        fail(`showCategory: no container found for id "${categoryId}".`);
    }
}

/* =========================================================================
 * Toolbar visibility
 * ========================================================================= */

/**
 * Shows or hides the view-controls toolbar based on whether the user
 * can access any views.
 *
 * The toolbar holds controls that operate on views (the global
 * show/hide toggles for entry lines). With no accessible views, there
 * is nothing for those controls to act on, so the toolbar is hidden.
 * The header is not affected: its controls (language, view selection)
 * are independent of content.
 *
 * Visibility is expressed as a CSS class rather than the `hidden`
 * attribute, so that what "hidden" means is a CSS concern.
 */
function syncViewToolbarVisibility() {
    const toolbar = requireElement(SELECTORS.toolbar, HTMLElement);
    const hasViews = accessibleViews().length > 0;
    toolbar.classList.toggle(CLASS_HIDDEN, !hasViews);
}

/* =========================================================================
 * Entry-line visibility (drill state)
 * ========================================================================= */

/**
 * Returns the entry-line buttons within the given view for the given
 * language. Returns an empty array if the view is null or has no such
 * lines.
 *
 * @param {?string} categoryId - View id, or null.
 * @param {"ru"|"en"} lang - Entry language.
 * @returns {HTMLButtonElement[]} Matching buttons.
 */
function entryLinesIn(categoryId, lang) {
    if (categoryId === null) {
        return [];
    }

    const container = document.querySelector(`[${ATTR.categoryId}="${categoryId}"]`);
    if (!container) {
        fail(`entryLinesIn: no container found for view "${categoryId}".`);
    }

    const lines = container.querySelectorAll(
        `[${ATTR.entryLine}][${ATTR.entryLang}="${lang}"]`
    );

    return Array.from(lines).filter((el) => el instanceof HTMLButtonElement);
}

/**
 * Returns whether all entry lines of the given language in the given
 * view are revealed. Returns true for an empty set (vacuously).
 *
 * @param {?string} categoryId - View id, or null.
 * @param {"ru"|"en"} lang - Entry language.
 * @returns {boolean} True if every line is revealed.
 */
function allLinesRevealed(categoryId, lang) {
    const lines = entryLinesIn(categoryId, lang);
    return lines.every((line) => line.getAttribute("aria-pressed") === "true");
}

/**
 * Sets every entry line of the given language in the given view to the
 * given visibility.
 *
 * @param {?string} categoryId - View id, or null.
 * @param {"ru"|"en"} lang - Entry language.
 * @param {boolean} revealed - Target visibility.
 */
function setAllLinesRevealed(categoryId, lang, revealed) {
    const lines = entryLinesIn(categoryId, lang);
    for (const line of lines) {
        line.setAttribute("aria-pressed", revealed ? "true" : "false");
    }
}

/**
 * Returns the i18n key for the label of a global toggle button.
 *
 * @param {"ru"|"en"} lang - Entry language.
 * @param {boolean} allRevealed - Whether all lines are revealed.
 * @returns {string} The i18n key.
 */
function globalButtonKey(lang, allRevealed) {
    if (lang === "ru") {
        return allRevealed ? "controls.hideAllRussian" : "controls.showAllRussian";
    }
    if (lang === "en") {
        return allRevealed ? "controls.hideAllEnglish" : "controls.showAllEnglish";
    }
    fail(`globalButtonKey: unsupported language "${lang}".`);
}

/**
 * Updates one global toggle button's label and aria-pressed state.
 *
 * @param {"ru"|"en"} lang - Entry language this button controls.
 * @param {?string} categoryId - Active view id, or null.
 * @param {string} buttonSelector - Selector for the button.
 * @param {string} labelSelector - Selector for the label span.
 */
function syncGlobalButton(lang, categoryId, buttonSelector, labelSelector) {
    const button = requireElement(buttonSelector, HTMLButtonElement);
    const label = requireElement(labelSelector, HTMLElement);

    const allRevealed = allLinesRevealed(categoryId, lang);
    label.textContent = getString(globalButtonKey(lang, allRevealed));
    button.setAttribute("aria-pressed", allRevealed ? "true" : "false");
}

/**
 * Updates both global toggle buttons to reflect the current state of
 * the active view. Safe to call when no view is selected: the buttons
 * keep their current labels and state.
 */
function syncGlobalButtons() {
    const categoryId = selectedViewId();

    if (categoryId === null) {
        // No view selected. This is a valid state (empty manifest, or
        // before the first view is selected at boot). There is nothing
        // for the toggles to control.
        return;
    }

    syncGlobalButton("ru", categoryId, SELECTORS.toggleRu, SELECTORS.toggleRuLabel);
    syncGlobalButton("en", categoryId, SELECTORS.toggleEn, SELECTORS.toggleEnLabel);
}

/**
 * Marks the currently active UI language button.
 */
function syncLangButtons() {
    const current = getCurrentLanguage();

    for (const button of queryAll(SELECTORS.langButton)) {
        if (!(button instanceof HTMLButtonElement)) {
            continue;
        }
        const lang = button.getAttribute("data-ui-lang");
        button.setAttribute("aria-pressed", lang === current ? "true" : "false");
    }
}

/* =========================================================================
 * Event handlers
 * ========================================================================= */

/**
 * Handles clicks on the main container. Delegates to entry-line
 * toggles.
 *
 * @param {MouseEvent} event - The click event.
 */
function handleMainClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    const line = target.closest(`[${ATTR.entryLine}]`);
    if (!(line instanceof HTMLButtonElement)) {
        return;
    }

    const currentlyPressed = line.getAttribute("aria-pressed") === "true";
    line.setAttribute("aria-pressed", currentlyPressed ? "false" : "true");
    syncGlobalButtons();
}

/**
 * Handles a click on one of the global show/hide buttons.
 *
 * @param {"ru"|"en"} lang - Entry language this button controls.
 */
function handleGlobalToggle(lang) {
    const categoryId = selectedViewId();
    if (categoryId === null) {
        return;
    }

    const allRevealed = allLinesRevealed(categoryId, lang);
    setAllLinesRevealed(categoryId, lang, !allRevealed);
    syncGlobalButtons();
}

/**
 * Handles category dropdown change.
 *
 * @param {Event} event - The change event.
 */
function handleCategoryChange(event) {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
        fail(`handleCategoryChange received an event whose target is not a <select>.`);
    }

    if (select.value !== "") {
        showCategory(select.value);
    }
    syncGlobalButtons();
}

/**
 * Handles UI language button click.
 *
 * @param {"ru"|"en"} lang - Target UI language.
 */
function handleUiLangChange(lang) {
    setLanguage(lang);
    syncGlobalButtons();
    syncLangButtons();
}

/* =========================================================================
 * Event wiring
 * ========================================================================= */

/**
 * Attaches all event listeners. Independent of loaded content: this is
 * called on every boot, whether or not any views were loaded. The
 * controls it wires up either work without content (language buttons)
 * or are hidden when there is no content (global toggles).
 */
function bindEvents() {
    requireElement(SELECTORS.main, HTMLElement).addEventListener("click", handleMainClick);
    requireElement(SELECTORS.categorySelect, HTMLSelectElement).addEventListener("change", handleCategoryChange);
    requireElement(SELECTORS.toggleRu, HTMLButtonElement).addEventListener("click", () => handleGlobalToggle("ru"));
    requireElement(SELECTORS.toggleEn, HTMLButtonElement).addEventListener("click", () => handleGlobalToggle("en"));

    for (const button of queryAll(SELECTORS.langButton)) {
        if (!(button instanceof HTMLButtonElement)) {
            continue;
        }
        button.addEventListener("click", () => {
            const lang = button.getAttribute("data-ui-lang");
            if (lang !== "ru" && lang !== "en") {
                fail(`UI lang button has invalid data-ui-lang="${lang}".`);
            }
            handleUiLangChange(lang);
        });
    }
}

/* =========================================================================
 * Boot phases
 * ========================================================================= */

/**
 * Phase 1: initialize the i18n module and localize the static UI.
 *
 * The i18n module requires configure() to be called before any other
 * export, and strings to be registered before applyLanguage(). This
 * function performs those steps in order and starts the observer.
 *
 * @throws {Error} If i18n configuration or string registration fails.
 */
function bootstrapI18n() {
    configure({
        supportedLanguages: SUPPORTED_LANGUAGES,
        defaultLanguage: DEFAULT_LANGUAGE,
    });

    registerStrings("ru", uiStrings.ru);
    registerStrings("en", uiStrings.en);

    applyLanguage(getCurrentLanguage());

    startAutoLocalization();
}

/**
 * Phase 2: load and validate grammar content, register content strings.
 *
 * @returns {Promise<Object>} The validated grammar data.
 * @throws {Error} If fetching or validation fails.
 */
async function loadContent() {
    const data = await fetchData(MANIFEST_URL);
    registerContentStrings(data);
    return data;
}

/**
 * Phase 3: attach the UI to the loaded content.
 *
 * Renders categories, populates the dropdown, syncs toolbar visibility,
 * binds all event listeners, and — if any views are accessible —
 * selects the first one.
 *
 * The listener binding happens unconditionally: there is no code path
 * through this function that returns before bindEvents() is called.
 * That property is what keeps the language buttons working when the
 * manifest is empty.
 *
 * @param {Object} data - Validated grammar data.
 */
function mountUi(data) {
    // Render each category's DOM: a container per category, each
    // holding its collapsible sections and entry lines.
    renderCategories(data.categories);

    // Fill the category dropdown with one option per category. Must
    // run before syncViewToolbarVisibility(), which reads the dropdown to
    // determine whether the toolbar is needed.
    populateDropdown(data.categories);

    // Show or hide the view-controls toolbar based on whether the
    // dropdown has any options. Depends on populateDropdown() above.
    syncViewToolbarVisibility();

    // Wire up all event listeners: main-container clicks (entry-line
    // toggles), category dropdown changes, global toggle buttons, and
    // language buttons.
    bindEvents();

    // Mark the currently active UI language button with
    // aria-pressed="true".
    syncLangButtons();

    // Select the first view so the app opens on something. Skipped
    // when the manifest is empty, which is a valid state.
    const firstId = data.categories[0]?.id ?? null;
    if (firstId !== null) {
        const select = requireElement(SELECTORS.categorySelect, HTMLSelectElement);
        select.value = firstId;
        // Set the active view.
        showCategory(firstId);
        // Update aria labels based on active view.
        syncGlobalButtons();
    }
}

/**
 * Reports a fatal error by logging it and, if possible, displaying a
 * generic message in the status element. Never throws: a failure
 * inside error reporting must not obscure the original error.
 *
 * @param {Error} error - The error to report.
 */
function reportFatal(error) {
    console.error(error);

    const status = document.querySelector(SELECTORS.status);
    if (!(status instanceof HTMLElement)) {
        console.error("reportFatal: status element not found; cannot display error to user.");
        return;
    }
    status.textContent = getString("status.loadFailed");
    status.hidden = false;
}

/**
 * Application entry point. Runs the three boot phases in order.
 *
 * Phase order is required: i18n must be configured before anything
 * calls into it, and content strings must be registered before the UI
 * renders any content that references them. If a phase fails, the
 * remaining phases are skipped and the error is reported to the user.
 */
async function init() {
    bootstrapI18n();

    let data;
    try {
        data = await loadContent();
    } catch (error) {
        reportFatal(error);
        return;
    }

    mountUi(data);
}

init();