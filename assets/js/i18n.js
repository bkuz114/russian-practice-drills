/**
 * i18n.js
 *
 * Internationalization mechanism. Resolves localized strings and
 * applies them to the DOM via attribute-driven localization.
 *
 * This module is a mechanism, not a repository. It ships with NO
 * strings. All strings are supplied at runtime:
 *   - UI strings via registerStrings(), typically at boot.
 *   - Content strings via registerStrings(), typically after data load.
 *   - Namespace strings via a namespaceResolver supplied to configure()
 *     (see below), for consumers that support per-element namespace
 *     scoping.
 *
 * Responsibilities:
 *   - Maintain per-language string dictionaries, populated at runtime.
 *   - Resolve dot-notation keys against those dictionaries.
 *   - Apply the active language to [data-i18n] elements in place.
 *   - Handle placeholder substitution via [data-i18n-substitutions].
 *   - Honor per-element namespace scoping via a consumer-supplied
 *     namespaceResolver (see "Namespaces" below).
 *   - Surface lookup failures loudly. No silent fallbacks, no silent
 *     returns.
 *
 * Localization is driven by HTML attributes:
 *   - data-i18n              → element.textContent
 *   - data-i18n-placeholder  → element.placeholder
 *   - data-i18n-aria-label   → element.aria-label
 *   - data-i18n-lang         → element.lang
 *
 * Elements may opt out of specific attributes with data-i18n-exclude,
 * whose value is a JSON array of regex patterns:
 *   data-i18n-exclude='["data-i18n-.*"]'
 *
 * Placeholder substitution uses data-i18n-substitutions, whose value is
 * a JSON object keyed by target attribute:
 *   data-i18n-substitutions='{"data-i18n": {"n": 2}}'
 * The string template uses {curly} placeholders.
 *
 * ──────────────────────────────────────────────────────────────────
 * Namespaces
 * ──────────────────────────────────────────────────────────────────
 *
 * A "namespace" is a named string table that can override keys in the
 * shared dictionary for elements scoped to it. This supports apps
 * where the same key means different things in different contexts
 * (e.g. per-view overrides in a shell-and-views architecture).
 *
 * Namespace scoping is driven by three attributes:
 *   - data-i18n-view         → marks a subtree as belonging to a
 *                              namespace; the value is the namespace id.
 *   - data-i18n-force-view   → force resolution against a specific
 *                              namespace regardless of ancestor scoping.
 *   - data-i18n-force-shared → force resolution against the shared
 *                              dictionary, ignoring any namespace scope.
 *
 * Namespaces are resolved by a namespaceResolver function supplied to
 * configure(). The resolver maps a namespace id to a per-language
 * string table, or returns undefined if the namespace does not exist.
 * Apps that don't use namespaces simply omit the resolver; in that
 * case, a data-i18n-view attribute in the DOM is a configuration
 * error and is reported loudly.
 *
 * ──────────────────────────────────────────────────────────────────
 * Provisional design decisions
 * ──────────────────────────────────────────────────────────────────
 *
 * This module was generalized to unblock the grammar-drills app while
 * preserving the features the view-registry app depends on. The
 * following decisions were made to unblock and should be revisited
 * when the module is generalized in earnest:
 *
 *   1. The namespaceResolver signature is:
 *          namespaceResolver(namespaceId) → { ru: {...}, en: {...} }
 *      i.e. the resolver returns the whole per-language table and the
 *      module selects the language. An alternative would push language
 *      selection into the resolver. Chosen for a smaller interface and
 *      to keep language handling inside the module.
 *
 *   2. configure() accepts supportedLanguages, defaultLanguage, and
 *      an optional namespaceResolver. Strings are NOT part of
 *      configure(); they go through registerStrings() exclusively, so
 *      there is exactly one string-registration path.
 *
 * These are documented so future maintainers know they were
 * deliberate-but-unsettled, not accidental.
 *
 * Dependencies:
 *   - template-engine.js (TemplateEngine)
 */

import {
    TemplateEngine
} from "./template-engine.js";

/**
 * Opening delimiter for placeholder substitution in localized strings.
 */
export const I18N_TEMPLATE_OPEN_DELIM = "{";

/**
 * Closing delimiter for placeholder substitution in localized strings.
 */
export const I18N_TEMPLATE_CLOSE_DELIM = "}";

/**
 * Attribute name for excluding elements from specific i18n attributes.
 * Value must be a JSON array of regex patterns (as strings).
 */
export const I18N_EXCLUDE_KEY = "data-i18n-exclude";

/**
 * Attribute name for providing placeholder substitution values.
 * Value must be a JSON object keyed by target i18n attribute.
 */
export const I18N_SUBSTITUTIONS_KEY = "data-i18n-substitutions";

/**
 * Attribute name marking a subtree as scoped to a namespace. The value
 * is the namespace id.
 */
export const I18N_VIEW_KEY = "data-i18n-view";

/**
 * Attribute name for forcing resolution against a specific namespace,
 * regardless of ancestor scoping. The value is the namespace id.
 */
export const I18N_VIEW_OVERRIDE_KEY = "data-i18n-force-view";

/**
 * Attribute name for forcing resolution against the shared dictionary,
 * ignoring any namespace scope.
 */
export const I18N_SHARE_OVERRIDE_KEY = "data-i18n-force-shared";

/**
 * The TemplateEngine instance used for placeholder substitution.
 * The delimiters are module constants, so a single instance is
 * sufficient and avoids per-call construction. Constructed at module
 * load so that any construction error surfaces immediately.
 *
 * @type {TemplateEngine}
 */
const templateEngine = new TemplateEngine({
    openDelim: I18N_TEMPLATE_OPEN_DELIM,
    closeDelim: I18N_TEMPLATE_CLOSE_DELIM,
});

/**
 * Maps i18n attributes to functions that write the resolved value
 * onto the element.
 *
 * @type {Object<string, (element: HTMLElement, value: string) => void>}
 */
const I18N_ATTRIBUTE_HANDLERS = {
    "data-i18n": (element, value) => {
        element.textContent = value;
    },
    "data-i18n-placeholder": (element, value) => {
        element.setAttribute("placeholder", value);
    },
    "data-i18n-aria-label": (element, value) => {
        element.setAttribute("aria-label", value);
    },
    "data-i18n-lang": (element, value) => {
        element.setAttribute("lang", value);
    },
};

/**
 * Module configuration set by configure(). Null until configured.
 *
 * @type {?{
 *   supportedLanguages: string[],
 *   defaultLanguage: string,
 *   namespaceResolver: ?function(string): (Object<string, Object>|undefined)
 * }}
 */
let config = null;

/**
 * The active language code. Initialized from config.defaultLanguage
 * on configure().
 *
 * @type {?string}
 */
let currentLanguage = null;

/**
 * Per-language string dictionaries, keyed by language code, then by
 * dot-notation key path.
 *
 * Populated exclusively by registerStrings(). Starts empty.
 *
 * @type {Object<string, Object>}
 */
const STRINGS = {};

/**
 * Throws an Error with a diagnostic message.
 *
 * @param {string} message - Description of the failure.
 * @throws {Error} Always.
 */
function fail(message) {
    throw new Error(`i18n: ${message}`);
}

/**
 * Throws a TypeError with a diagnostic message.
 *
 * @param {string} message - Description of the failure.
 * @throws {TypeError} Always.
 */
function failType(message) {
    throw new TypeError(`i18n: ${message}`);
}

/**
 * Asserts that the module has been configured. Called at the top of
 * every exported function that depends on configuration. Throws with
 * a clear diagnostic if configure() has not been called.
 *
 * @throws {Error} If configure() has not been called.
 */
function assertConfigured() {
    if (config === null) {
        fail(
            "Module not configured. Call configure({ supportedLanguages, defaultLanguage }) before any other i18n function."
        );
    }
}

/**
 * Asserts that the given language is supported.
 *
 * @param {string} lang - Language code to validate.
 * @param {string} context - Description of the caller, for the error message.
 * @throws {TypeError} If lang is not a supported language.
 */
function assertSupportedLanguage(lang, context) {
    if (typeof lang !== "string" || !config.supportedLanguages.includes(lang)) {
        failType(
            `${context}: expected one of [${config.supportedLanguages.join(", ")}], received: ${JSON.stringify(lang)}`
        );
    }
}

/**
 * Configures the i18n module. Must be called exactly once, before any
 * other exported function.
 *
 * Does not register strings. Use registerStrings() for that.
 *
 * @param {Object} options - Configuration.
 * @param {string[]} options.supportedLanguages - Non-empty array of
 *     supported language codes (e.g. ["ru", "en"]).
 * @param {string} options.defaultLanguage - Default language code;
 *     must be a member of supportedLanguages.
 * @param {function(string): (Object|undefined)} [options.namespaceResolver]
 *     - Optional. Maps a namespace id to a per-language string table
 *     ({ ru: {...}, en: {...} }) or undefined if the namespace does
 *     not exist. Apps without namespace support omit this.
 * @throws {Error} If called more than once.
 * @throws {TypeError} If arguments are invalid.
 */
export function configure({
    supportedLanguages,
    defaultLanguage,
    namespaceResolver = null,
} = {}) {
    if (config !== null) {
        fail("configure() called more than once. Configuration is set once at boot.");
    }

    if (!Array.isArray(supportedLanguages) || supportedLanguages.length === 0) {
        failType(
            `configure: supportedLanguages must be a non-empty array, received: ${JSON.stringify(supportedLanguages)}`
        );
    }
    for (const lang of supportedLanguages) {
        if (typeof lang !== "string" || lang.length === 0) {
            failType(
                `configure: every entry in supportedLanguages must be a non-empty string, received: ${JSON.stringify(lang)}`
            );
        }
    }

    if (typeof defaultLanguage !== "string" || !supportedLanguages.includes(defaultLanguage)) {
        failType(
            `configure: defaultLanguage must be one of [${supportedLanguages.join(", ")}], received: ${JSON.stringify(defaultLanguage)}`
        );
    }

    if (namespaceResolver !== null && typeof namespaceResolver !== "function") {
        failType(
            `configure: namespaceResolver must be a function or omitted, received: ${typeof namespaceResolver}`
        );
    }

    config = {
        supportedLanguages: [...supportedLanguages],
        defaultLanguage,
        namespaceResolver,
    };
    currentLanguage = defaultLanguage;

    // Initialize empty string tables for each supported language so
    // that registerStrings has a place to merge into.
    for (const lang of supportedLanguages) {
        STRINGS[lang] = {};
    }
}

/**
 * Returns the configured supported languages.
 *
 * @returns {string[]} A copy of the supported language codes.
 * @throws {Error} If the module is not configured.
 */
export function getSupportedLanguages() {
    assertConfigured();
    return [...config.supportedLanguages];
}

/**
 * Returns the currently active language code.
 *
 * @returns {string} The active language code.
 * @throws {Error} If the module is not configured.
 */
export function getCurrentLanguage() {
    assertConfigured();
    return currentLanguage;
}

/**
 * Sets the active language and re-applies localization to the document.
 *
 * Does not persist the preference. Persistence is a caller concern.
 *
 * @param {string} lang - Language code; must be supported.
 * @throws {Error} If the module is not configured.
 * @throws {TypeError} If lang is not a supported language.
 */
export function setLanguage(lang) {
    assertConfigured();
    assertSupportedLanguage(lang, "setLanguage");

    currentLanguage = lang;
    applyLanguage(lang);
}

/**
 * Registers strings for a language. Deep-merges the supplied table
 * into the language's dictionary.
 *
 * Called at boot for UI strings, and after data load for content
 * strings. May be called any number of times.
 *
 * @param {string} lang - Language code; must be supported.
 * @param {Object} table - Nested object mirroring the dictionary's
 *     shape. Leaves must be strings.
 * @param {Object} [options] - Registration options.
 * @param {boolean} [options.overwrite=false] - If true, existing keys
 *     are overwritten. If false (default), existing keys are preserved
 *     and a warning is logged.
 * @throws {Error} If the module is not configured.
 * @throws {TypeError} If arguments are invalid, or if a leaf value is
 *     not a string.
 */
export function registerStrings(lang, table, {
    overwrite = false
} = {}) {
    assertConfigured();
    assertSupportedLanguage(lang, "registerStrings");

    if (typeof table !== "object" || table === null || Array.isArray(table)) {
        failType(
            `registerStrings: table must be a plain object, received: ${Object.prototype.toString.call(table)}`
        );
    }

    mergeTable(STRINGS[lang], table, [], overwrite);
}

/**
 * Recursively merges source into target. Leaf values must be strings.
 * On key collision, overwrites if `overwrite` is true; otherwise logs
 * a warning and skips.
 *
 * @param {Object} target - Destination object (mutated).
 * @param {Object} source - Source object.
 * @param {string[]} path - Key path so far, for diagnostics.
 * @param {boolean} overwrite - Whether collisions overwrite.
 * @throws {TypeError} If a leaf value is not a string, or a structural
 *     mismatch occurs.
 */
function mergeTable(target, source, path, overwrite) {
    for (const [key, value] of Object.entries(source)) {
        const here = path.concat(key);
        const herePath = here.join(".");

        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            // Structural node. Ensure target has an object at this key.
            if (!(key in target)) {
                target[key] = {};
            } else if (typeof target[key] !== "object" || target[key] === null || Array.isArray(target[key])) {
                failType(
                    `registerStrings: structural mismatch at "${herePath}". Existing value is not an object.`
                );
            }
            mergeTable(target[key], value, here, overwrite);
            continue;
        }

        if (Array.isArray(value)) {
            failType(
                `registerStrings: arrays are not supported as string table values (at "${herePath}").`
            );
        }

        if (typeof value !== "string") {
            failType(
                `registerStrings: leaf value at "${herePath}" must be a string, received: ${Object.prototype.toString.call(value)}`
            );
        }

        if (key in target) {
            if (!overwrite) {
                console.warn(
                    `i18n: registerStrings: key "${herePath}" already registered; skipping (pass { overwrite: true } to replace).`
                );
                continue;
            }
        }

        target[key] = value;
    }
}

/**
 * Retrieves a nested value from an object using dot-notation path.
 *
 * @param {Object} obj - The object to search.
 * @param {string} path - Dot-separated key path.
 * @returns {string|undefined} The value at the path, or undefined.
 */
function getNestedValue(obj, path) {
    const segments = path.split(".");
    let current = obj;

    for (const segment of segments) {
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }

    return current;
}

/**
 * Resolves an i18n key to its localized string.
 *
 * @param {string} key - Dot-notation key.
 * @param {Object} [options] - Lookup options.
 * @param {string} [options.lang] - Language code; defaults to current.
 * @param {boolean} [options.logErrorIfNotFound=true] - Whether to log
 *     on miss.
 * @param {Object} [options.stringTable] - Optional explicit table to
 *     resolve against, used for namespace lookups. If omitted, the
 *     shared dictionary for `lang` is used.
 * @param {string} [options.sourceLabel] - Description of the source,
 *     used in error messages. Only meaningful when `stringTable` is
 *     supplied.
 * @returns {string|undefined} The resolved string, or undefined.
 * @throws {Error} If the module is not configured.
 * @throws {TypeError} If key or lang are invalid.
 */
export function getString(key, {
    lang = currentLanguage,
    logErrorIfNotFound = true,
    stringTable = null,
    sourceLabel = null,
} = {}) {
    assertConfigured();

    if (typeof key !== "string" || key.length === 0) {
        failType(
            `getString: expected a non-empty string key, received: ${JSON.stringify(key)}`
        );
    }
    assertSupportedLanguage(lang, "getString");

    let table;
    let label;

    if (stringTable !== null) {
        table = stringTable;
        label = sourceLabel || "supplied string table";
    } else {
        table = STRINGS[lang];
        label = `shared strings for "${lang}"`;
    }

    const value = getNestedValue(table, key);

    if (value === undefined) {
        if (logErrorIfNotFound) {
            console.error(
                `i18n: Key "${key}" not found in ${label}. ` +
                `If this is a content key, ensure registerStrings() was called for it before the element was rendered.`
            );
        }
        return undefined;
    }

    return value;
}

/**
 * Tests whether a string matches a regex pattern.
 *
 * @param {string} str - String to test.
 * @param {string} pattern - Regex source pattern.
 * @returns {boolean} True if the pattern matches.
 */
function matchesPattern(str, pattern) {
    try {
        return new RegExp(pattern).test(str);
    } catch (error) {
        console.error(
            `i18n: Invalid regex pattern ${JSON.stringify(pattern)}. Error: ${error.message}`
        );
        return false;
    }
}

/**
 * Reads and validates the exclusion list from an element.
 *
 * @param {HTMLElement} element - Element to inspect.
 * @returns {string[]} Array of regex patterns. Empty if none or invalid.
 */
function getExcludedAttributes(element) {
    const raw = element.getAttribute(I18N_EXCLUDE_KEY);

    if (!raw) {
        return [];
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.error(
            `i18n: Failed to parse ${I18N_EXCLUDE_KEY}. ` +
            `Attribute value: ${raw}. Error: ${error.message}`,
            element
        );
        return [];
    }

    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
        console.error(
            `i18n: ${I18N_EXCLUDE_KEY} must be a JSON array of strings. ` +
            `Received: ${JSON.stringify(parsed)}`,
            element
        );
        return [];
    }

    return parsed;
}

/**
 * Applies template substitutions to a resolved string.
 *
 * Reads data-i18n-substitutions from the element, extracts values for
 * the target attribute, and delegates to the TemplateEngine.
 *
 * @param {string} template - The resolved string, possibly with placeholders.
 * @param {HTMLElement} element - Element carrying data-i18n-substitutions.
 * @param {string} targetAttribute - The i18n attribute being processed.
 * @returns {string} The substituted string, or the original on any failure.
 */
function applyTemplateValues(template, element, targetAttribute) {
    const rawJsonString = element.getAttribute(I18N_SUBSTITUTIONS_KEY);

    if (rawJsonString === null) {
        return template;
    }

    const errorContext =
        `  Element: ${element.outerHTML}\n` +
        `  Attribute: ${targetAttribute}\n` +
        `  Template: "${template}"\n` +
        `  ${I18N_SUBSTITUTIONS_KEY}: ${rawJsonString}`;

    let substitutions;
    try {
        substitutions = JSON.parse(rawJsonString);
    } catch (error) {
        console.error(
            `i18n: Invalid JSON in ${I18N_SUBSTITUTIONS_KEY}.\n` +
            `  ${errorContext}\n` +
            `  Error: ${error.message}`
        );
        return template;
    }

    if (typeof substitutions !== "object" || substitutions === null || Array.isArray(substitutions)) {
        console.error(
            `i18n: ${I18N_SUBSTITUTIONS_KEY} must parse to an object.\n  ${errorContext}`
        );
        return template;
    }

    const values = substitutions[targetAttribute];

    if (values === undefined) {
        return template;
    }

    if (typeof values !== "object" || values === null || Array.isArray(values)) {
        console.error(
            `i18n: Substitutions for "${targetAttribute}" must be an object.\n  ${errorContext}`
        );
        return template;
    }

    const result = templateEngine.apply(template, values);

    if (result.errors.length > 0) {
        console.error(
            `i18n: Template substitution failed.\n` +
            `  ${errorContext}\n` +
            `  Errors:\n` +
            result.errors.map((e) => `    - ${e}`).join("\n")
        );
    }

    if (result.warnings.length > 0) {
        console.warn(
            `i18n: Template substitution warnings.\n` +
            `  ${errorContext}\n` +
            `  Warnings:\n` +
            result.warnings.map((w) => `    - ${w}`).join("\n")
        );
    }

    return result.value;
}

/**
 * Resolves the localized value for a specific i18n attribute on an
 * element, honoring namespace scoping.
 *
 * Resolution precedence:
 *   1. data-i18n-force-shared present → shared dictionary only.
 *   2. data-i18n-force-view present   → that namespace's dictionary,
 *      falling back to shared if the key is absent there.
 *   3. Ancestor with data-i18n-view   → that namespace's dictionary,
 *      falling back to shared if the key is absent there.
 *   4. Otherwise                      → shared dictionary.
 *
 * @param {HTMLElement} element - Element carrying the attribute.
 * @param {string} i18nAttr - The i18n attribute name.
 * @param {string} lang - Language code.
 * @returns {string|undefined} The resolved string, or undefined.
 * @throws {Error} If the module is not configured.
 * @throws {TypeError} If arguments are invalid.
 */
export function resolveElementI18nValue(element, i18nAttr, lang) {
    assertConfigured();

    if (!(element instanceof HTMLElement)) {
        failType(
            `resolveElementI18nValue: expected an HTMLElement, received: ${Object.prototype.toString.call(element)}`
        );
    }
    if (typeof i18nAttr !== "string" || i18nAttr.length === 0) {
        failType(
            `resolveElementI18nValue: expected a non-empty attribute name, received: ${JSON.stringify(i18nAttr)}`
        );
    }
    assertSupportedLanguage(lang, "resolveElementI18nValue");

    const key = element.getAttribute(i18nAttr);

    if (!key || key.length === 0) {
        console.warn(
            `i18n: Element has empty "${i18nAttr}" attribute.`,
            element
        );
        return undefined;
    }

    if (
        element.hasAttribute(I18N_VIEW_OVERRIDE_KEY) &&
        element.hasAttribute(I18N_SHARE_OVERRIDE_KEY)
    ) {
        console.error(
            `i18n: Element has both "${I18N_VIEW_OVERRIDE_KEY}" and "${I18N_SHARE_OVERRIDE_KEY}"; the force-shared attribute wins.`,
            element
        );
    }

    const forceShared = element.hasAttribute(I18N_SHARE_OVERRIDE_KEY);
    const forcedNamespaceId = element.getAttribute(I18N_VIEW_OVERRIDE_KEY);
    const ancestorNamespaceId = element
        .closest(`[${I18N_VIEW_KEY}]`)
        ?.getAttribute(I18N_VIEW_KEY);
    const namespaceId = forcedNamespaceId || ancestorNamespaceId;

    const wantsNamespace = !forceShared && namespaceId;

    if (wantsNamespace) {
        if (config.namespaceResolver === null) {
            // The DOM requested namespace scoping, but the app never
            // supplied a resolver. This is a configuration error:
            // either the markup is wrong or configure() is missing the
            // resolver. Fail loudly.
            fail(
                `Element requested namespace "${namespaceId}" (via "${I18N_VIEW_OVERRIDE_KEY}" or ancestor "${I18N_VIEW_KEY}"), ` +
                `but no namespaceResolver was supplied to configure().`
            );
        }

        const namespaceTable = config.namespaceResolver(namespaceId);

        if (namespaceTable !== undefined && namespaceTable !== null) {
            const langTable = namespaceTable[lang];

            if (langTable !== undefined && langTable !== null) {
                const value = getString(key, {
                    lang,
                    logErrorIfNotFound: false,
                    stringTable: langTable,
                    sourceLabel: `namespace "${namespaceId}" for language "${lang}"`,
                });

                if (value !== undefined) {
                    return applyTemplateValues(value, element, i18nAttr);
                }
            }

            // Namespace exists but does not have the key; fall through
            // to the shared dictionary.
        }
        // Namespace does not exist; fall through to the shared
        // dictionary. This mirrors the old module's behavior: a
        // missing namespace is not fatal, only a missing key everywhere
        // is.
    }

    const value = getString(key, {
        lang
    });
    if (value === undefined) {
        return undefined;
    }

    return applyTemplateValues(value, element, i18nAttr);
}

/**
 * Applies localization to a single element for all i18n attributes
 * it carries.
 *
 * @param {HTMLElement} element - Element to localize.
 * @param {string} lang - Language code.
 * @throws {Error} If the module is not configured.
 * @throws {TypeError} If arguments are invalid.
 */
export function applyLanguageToElement(element, lang) {
    assertConfigured();

    if (!(element instanceof HTMLElement)) {
        failType(
            `applyLanguageToElement: expected an HTMLElement, received: ${Object.prototype.toString.call(element)}`
        );
    }
    assertSupportedLanguage(lang, "applyLanguageToElement");

    const excluded = getExcludedAttributes(element);

    for (const [attribute, handler] of Object.entries(I18N_ATTRIBUTE_HANDLERS)) {
        if (!element.hasAttribute(attribute)) {
            continue;
        }

        const isExcluded = excluded.some((pattern) => matchesPattern(attribute, pattern));
        if (isExcluded) {
            continue;
        }

        const value = resolveElementI18nValue(element, attribute, lang);
        if (value !== undefined) {
            handler(element, value);
        }
    }

    if (element === document.documentElement) {
        document.documentElement.lang = lang;
    }
}

/**
 * Collects all elements under root matching the selector, including
 * root itself if it matches.
 *
 * @param {Element|Document|DocumentFragment} root - Root to search.
 * @param {string} selector - CSS selector.
 * @returns {Element[]} Matching elements.
 */
function querySelectorAllIncludingRoot(root, selector) {
    const matches = [];
    if (root.matches && root.matches(selector)) {
        matches.push(root);
    }
    matches.push(...root.querySelectorAll(selector));
    return matches;
}

/**
 * Applies localization to root and all its descendants.
 *
 * @param {string} lang - Language code.
 * @param {Element|Document|DocumentFragment} [root=document] - Root to localize.
 * @throws {Error} If the module is not configured.
 * @throws {TypeError} If arguments are invalid.
 */
export function applyLanguage(lang, root = document) {
    assertConfigured();
    assertSupportedLanguage(lang, "applyLanguage");

    if (!root || typeof root.querySelectorAll !== "function") {
        failType(
            `applyLanguage: expected a queryable root, received: ${Object.prototype.toString.call(root)}`
        );
    }

    const allElements = querySelectorAllIncludingRoot(root, "*");
    for (const element of allElements) {
        applyLanguageToElement(element, lang);
    }

    if (root === document.documentElement) {
        document.documentElement.lang = lang;
    }
}

/**
 * Starts a MutationObserver that auto-localizes dynamically added
 * element subtrees with the current language.
 *
 * @returns {MutationObserver} The active observer.
 * @throws {Error} If the module is not configured.
 */
export function startAutoLocalization() {
    assertConfigured();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    continue;
                }
                applyLanguage(getCurrentLanguage(), node);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    return observer;
}