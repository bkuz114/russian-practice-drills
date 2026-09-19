/**
 * TemplateEngine
 *
 * A generic string templating engine. Provides validation and
 * substitution for placeholder patterns within a template string.
 *
 * Placeholders are delimited by configurable opening and closing
 * delimiters (defaults: "{" and "}"). Substitution values are
 * supplied as a plain object mapping placeholder names to primitive
 * values (string, number, boolean).
 *
 * The engine does not log. It returns structured result objects.
 * The caller decides how to handle errors.
 *
 * Example:
 *   const engine = new TemplateEngine();
 *
 *   const result = engine.apply(
 *       "Found {count} {word}",
 *       { count: 5, word: "слов" }
 *   );
 *
 *   result.value  → "Found 5 слов"
 *   result.errors → []
 *
 *   const badResult = engine.apply(
 *       "Found {count} {word}",
 *       { count: 5 }
 *   );
 *
 *   badResult.value  → "Found 5 {word}"
 *   badResult.errors → ["Missing value for placeholder "{word}""]
 */

export class TemplateEngine {
    /**
     * @param {Object} [options] - Configuration options.
     * @param {string} [options.openDelim="{"] - Opening delimiter.
     * @param {string} [options.closeDelim="}"] - Closing delimiter.
     */
    constructor({
        openDelim = "{",
        closeDelim = "}",
    } = {}) {
        // Validate openDelim is a non-empty string.
        if (typeof openDelim !== 'string' || openDelim.length === 0) {
            throw new TypeError(
                `TemplateEngine: Invalid openDelim. Expected non-empty string, received: ${openDelim}`
            );
        }

        // Validate closeDelim is a non-empty string.
        if (typeof closeDelim !== 'string' || closeDelim.length === 0) {
            throw new TypeError(
                `TemplateEngine: Invalid closeDelim. Expected non-empty string, received: ${closeDelim}`
            );
        }

        // Validate delimiters are not identical.
        if (openDelim === closeDelim) {
            throw new Error(
                `TemplateEngine: openDelim and closeDelim must be different. Both received: "${openDelim}"`
            );
        }

        this.openDelim = openDelim;
        this.closeDelim = closeDelim;
    }

    /**
     * Validate a single substitution value.
     *
     * Returns an error message if the value cannot be substituted,
     * or null if it is valid.
     *
     * @param {string} placeholderName - The placeholder name.
     * @param {*} value - The value to validate.
     * @returns {string|null} Error message or null.
     */
    validateSubstitutionValue(placeholderName, value) {
        // Only primitive values can be meaningfully substituted.
        if (
            typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean'
        ) {
            // js shows null as type Object which is misleading in
            // the error message. do a special check for if its
            // null else use typeof value
            const valueType = value === null ? 'null' : typeof value;
            return `Cannot substitute value for placeholder "${this.openDelim}${placeholderName}${this.closeDelim}". Value type: ${valueType}. Value: ${value}`;
        }

        return null;
    }

    /**
     * Validate that a template string contains only well-formed
     * placeholder patterns.
     *
     * A well-formed template has:
     *   - No unmatched opening or closing delimiters.
     *   - No empty placeholders (e.g., "{}").
     *   - No nested delimiters inside placeholders.
     *   - Delimiters appearing only in the correct order.
     *
     * Plain text with no delimiters is valid.
     *
     * @param {string} template - The template string to validate.
     * @returns {{valid: boolean, error: string|null}} Validation result.
     */
    validateTemplateString(template) {
        // Validate template is a string.
        if (typeof template !== 'string') {
            return {
                valid: false,
                error: `Invalid template argument. Expected string, received: ${template}`
            };
        }

        // Empty string is valid (nothing to validate).
        if (template.length === 0) {
            return {
                valid: true,
                error: null
            };
        }

        let openIndex = template.indexOf(this.openDelim);
        let closeIndex = template.indexOf(this.closeDelim);

        while (openIndex !== -1 || closeIndex !== -1) {
            // Closing delimiter appears before any opening delimiter.
            if (closeIndex !== -1 && (openIndex === -1 || closeIndex < openIndex)) {
                return {
                    valid: false,
                    error: `Unmatched closing delimiter "${this.closeDelim}" at position ${closeIndex}`
                };
            }

            // No closing delimiter for this opening delimiter.
            if (closeIndex === -1) {
                return {
                    valid: false,
                    error: `Unmatched opening delimiter "${this.openDelim}" at position ${openIndex}`
                };
            }

            // Empty placeholder: "{}".
            if (closeIndex === openIndex + this.openDelim.length) {
                return {
                    valid: false,
                    error: `Empty placeholder at position ${openIndex}`
                };
            }

            // Look for nested delimiters inside this placeholder.
            const innerContent = template.slice(
                openIndex + this.openDelim.length,
                closeIndex
            );

            if (
                innerContent.includes(this.openDelim) ||
                innerContent.includes(this.closeDelim)
            ) {
                return {
                    valid: false,
                    error: `Nested delimiter inside placeholder at position ${openIndex}`
                };
            }

            // Move past this valid placeholder and continue scanning.
            openIndex = template.indexOf(
                this.openDelim,
                closeIndex + this.closeDelim.length
            );
            closeIndex = template.indexOf(
                this.closeDelim,
                closeIndex + this.closeDelim.length
            );
        }

        return {
            valid: true,
            error: null
        };
    }

    /**
     * Extract placeholder names from a template string.
     *
     * Returns an array of unique placeholder names found in the template.
     * The template must be valid (passes validateTemplateString()) before calling this
     * method; behavior is undefined otherwise.
     *
     * Example:
     *   engine.extractPlaceholders("Found {count} of {count} {word}")
     *   → ["count", "word"]
     *
     * @param {string} template - The template string.
     * @returns {string[]} Unique placeholder names.
     */
    extractPlaceholders(template) {
        const placeholders = [];
        let searchIndex = 0;

        // Scan through the template for placeholder patterns.
        while (searchIndex < template.length) {
            // Find the next opening delimiter.
            const openIndex = template.indexOf(this.openDelim, searchIndex);

            // No more opening delimiters — stop scanning.
            if (openIndex === -1) {
                break;
            }

            // Find the matching closing delimiter.
            const closeIndex = template.indexOf(
                this.closeDelim,
                openIndex + this.openDelim.length
            );

            // No closing delimiter — stop scanning. This should not
            // happen if validateTemplateString() has already passed.
            if (closeIndex === -1) {
                break;
            }

            // Extract the placeholder name between delimiters.
            const name = template.slice(
                openIndex + this.openDelim.length,
                closeIndex
            );

            // Deduplicate: only add if not already present.
            if (!placeholders.includes(name)) {
                placeholders.push(name);
            }

            // Continue scanning after this placeholder.
            searchIndex = closeIndex + this.closeDelim.length;
        }

        return placeholders;
    }

    /**
     * Apply substitution values to a template string.
     *
     * All occurrences of each placeholder are replaced with the
     * corresponding value from the values object. Values must be
     * primitive (string, number, boolean). Objects and arrays are
     * rejected with an error.
     *
     * The template is validated before substitution. If validation
     * fails, the original template is returned unchanged along with
     * the validation error.
     *
     * If substitution errors occur (e.g., missing values, invalid
     * types), they are accumulated and returned in the errors array.
     * The value returned is the template with as many substitutions
     * applied as possible.
     *
     * @param {string} template - The template string.
     * @param {Object} values - Plain object mapping placeholder names
     *     to primitive values.
     * @returns {{value: string, errors: string[]}} Result object.
     */
    apply(template, values) {
        const errors = [];
        const warnings = [];

        // Validate template before any substitution.
        const validation = this.validateTemplateString(template);

        if (!validation.valid) {
            errors.push(validation.error);
            return {
                value: template,
                errors
            };
        }

        // Validate values is a non-null object, not an array.
        if (typeof values !== 'object' || values === null || Array.isArray(values)) {
            errors.push(
                `Invalid values argument. Expected plain object, received: ${values}`
            );
            return {
                value: template,
                errors
            };
        }

        // Perform substitutions: each key in JSON corresponds to
        // a template variable in the template string, and its value
        // is the substitution.
        let result = template;

        // Get all unique placeholder names from the template.
        const placeholderNames = this.extractPlaceholders(template);

        // Track which value keys were actually used for substitution.
        const usedKeys = [];

        for (const placeholderName of placeholderNames) {
            // Check if the value exists in the values object.
            if (!(placeholderName in values)) {
                errors.push(
                    `Missing value for placeholder "${this.openDelim}${placeholderName}${this.closeDelim}"`
                );
                continue;
            }

            // Mark this key as used.
            usedKeys.push(placeholderName);

            const value = values[placeholderName];

            // Validate the value is a primitive type.
            const validationError = this.validateSubstitutionValue(placeholderName, value);

            if (validationError !== null) {
                errors.push(validationError);
                continue;
            }

            // Substitute all occurrences of the placeholder.
            const placeholder = `${this.openDelim}${placeholderName}${this.closeDelim}`;
            result = result.replaceAll(placeholder, String(value));
        }

        // Identify values that were provided but not used by any
        // placeholder in the template.
        for (const key of Object.keys(values)) {
            if (!usedKeys.includes(key)) {
                warnings.push(
                    `Unused value for key "${key}" — no placeholder ${this.openDelim}${key}${this.closeDelim} in template`
                );
            }
        }

        // Check for any malformed placeholders introduced from substitution.
        const finalValidation = this.validateTemplateString(result);

        if (!finalValidation.valid) {
            errors.push(
                `Result validation failed after substitution. ${finalValidation.error}`
            );
        }

        return {
            value: result,
            errors: errors,
            warnings: warnings,
        };
    }
}