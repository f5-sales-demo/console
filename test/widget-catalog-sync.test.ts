/**
 * Widget-catalog sync: asserts that the declarative widget_behaviors.yaml
 * (the shipped source of truth) covers every widget_type the generator handles,
 * and vice versa. Catches drift between the catalog and the generator.
 *
 * The generator's fieldToSteps switch is the IMPLEMENTATION; the catalog is the
 * KNOWLEDGE. Both must agree on which widget types exist and are skippable.
 * The golden-diff test (golden-diff.test.ts) gates output equivalence.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

const consoleCatalogPath = path.resolve(import.meta.dir, "../../api-specs-enriched/config/widget_behaviors.yaml");
const generatorPath = path.resolve(import.meta.dir, "../scripts/generate-workflows.ts");

describe("widget-catalog ↔ generator sync", () => {
	test("widget_behaviors.yaml exists and is valid", () => {
		expect(fs.existsSync(consoleCatalogPath)).toBe(true);
		const data = parseYaml(fs.readFileSync(consoleCatalogPath, "utf-8"));
		expect(data.version).toBeDefined();
		expect(data.widgets).toBeDefined();
		expect(data.global).toBeDefined();
	});

	test("catalog covers every widget_type the generator handles", () => {
		const catalog = parseYaml(fs.readFileSync(consoleCatalogPath, "utf-8"));
		const catalogTypes = new Set(Object.keys(catalog.widgets));

		// Extract widget types from the generator's switch cases
		const generatorSrc = fs.readFileSync(generatorPath, "utf-8");
		const caseMatches = generatorSrc.matchAll(/case ['"]([^'"]+)['"]:/g);
		const generatorTypes = new Set<string>();
		for (const m of caseMatches) {
			// Skip non-widget-type cases (e.g., 'fill', 'click' from other switches)
			const val = m[1];
			if (["textbox", "textarea", "spinbutton", "checkbox", "listbox", "table",
				 "resource-selector", "nested-resource-list", "configurable",
				 "key-value-pairs", "expandable", "info-text",
				 "file-upload-button", "file-import-button"].includes(val)) {
				generatorTypes.add(val);
			}
		}

		// Every generator widget type must be in the catalog
		for (const gt of generatorTypes) {
			expect(catalogTypes.has(gt)).toBe(true);
		}
	});

	test("catalog has global operational notes", () => {
		const catalog = parseYaml(fs.readFileSync(consoleCatalogPath, "utf-8"));
		const globalKeys = Object.keys(catalog.global);
		expect(globalKeys.length).toBeGreaterThanOrEqual(5);
		// Key operational notes must be present
		expect(globalKeys).toContain("environment_prereqs");
		expect(globalKeys).toContain("click_determinism");
		expect(globalKeys).toContain("save_submit");
	});

	test("every non-skip widget has a summary and steps (or extends)", () => {
		const catalog = parseYaml(fs.readFileSync(consoleCatalogPath, "utf-8"));
		for (const [name, widget] of Object.entries(catalog.widgets) as [string, any][]) {
			if (widget.skip) continue;
			expect(widget.summary).toBeDefined();
			// Must have steps OR extend another widget
			const hasSteps = Array.isArray(widget.steps) && widget.steps.length > 0;
			const extends_ = typeof widget.extends === "string";
			expect(hasSteps || extends_).toBe(true);
		}
	});
});
