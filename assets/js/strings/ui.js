/**
 * ui.js
 *
 * UI strings for the Russian Grammar Drills app. Data only — no logic.
 *
 * Exports a per-language string table consumed by app.js at boot via
 * registerStrings(). The shape mirrors the i18n dictionary: nested
 * objects, string leaves, dot-notation keys when read via getString().
 *
 * Content strings (category names, section names) are NOT here; they
 * come from the loaded grammar data and are registered at runtime by
 * app.js. This file is only the static UI chrome.
 */

/**
 * UI strings keyed by language.
 *
 * @type {Object<string, Object>}
 */
export const uiStrings = {
    ru: {
        page: {
            title: "Тренажёр по русской грамматике",
        },
        controls: {
            categoryLabel: "Категория",
            categoryAriaLabel: "Выбор категории",
            contentToggleGroupAriaLabel: "Управление отображением содержимого",
            uiLangGroupAriaLabel: "Язык интерфейса",
            showAllRussian: "Показать весь русский",
            hideAllRussian: "Скрыть весь русский",
            showAllEnglish: "Показать весь английский",
            hideAllEnglish: "Скрыть весь английский",
        },
        status: {
            loading: "Загрузка…",
            loadFailed: "Не удалось загрузить данные. Проверьте консоль.",
            serveOverHttp: "Эту страницу необходимо открыть через HTTP-сервер (например, python -m http.server).",
            empty: "Нет доступных категорий.",
        },
        section: {
            toggleAriaLabel: "Развернуть или свернуть раздел",
        },
    },
    en: {
        page: {
            title: "Russian Grammar Drills",
        },
        controls: {
            categoryLabel: "Category",
            categoryAriaLabel: "Category selection",
            contentToggleGroupAriaLabel: "Content visibility controls",
            uiLangGroupAriaLabel: "Interface language",
            showAllRussian: "Show all Russian",
            hideAllRussian: "Hide all Russian",
            showAllEnglish: "Show all English",
            hideAllEnglish: "Hide all English",
        },
        status: {
            loading: "Loading…",
            loadFailed: "Failed to load data. Check the console.",
            serveOverHttp: "This page must be served over HTTP (e.g. python -m http.server).",
            empty: "No categories available.",
        },
        section: {
            toggleAriaLabel: "Expand or collapse section",
        },
    },
};