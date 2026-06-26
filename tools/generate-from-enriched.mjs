#!/usr/bin/env node

/**
 * Generate console catalog resource YAML from api-specs-enriched config.
 *
 * Reads console_ui.yaml and console_field_metadata.yaml from api-specs-enriched
 * and generates catalog/resources/*.yaml files for the console repo.
 *
 * This ensures the console catalog derives from the single source of truth
 * (api-specs-enriched) rather than being hand-authored.
 *
 * Usage:
 *   node tools/generate-from-enriched.mjs [--config-dir <path>] [--output-dir <path>]
 *
 * Default:
 *   --config-dir ../api-specs-enriched/config
 *   --output-dir catalog/resources
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const DEFAULT_CONFIG_DIR = join(ROOT, "..", "api-specs-enriched", "config");
const DEFAULT_OUTPUT_DIR = join(ROOT, "catalog", "resources");

function parseArgs() {
	const args = process.argv.slice(2);
	let configDir = DEFAULT_CONFIG_DIR;
	let outputDir = DEFAULT_OUTPUT_DIR;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--config-dir" && args[i + 1]) configDir = args[++i];
		if (args[i] === "--output-dir" && args[i + 1]) outputDir = args[++i];
	}

	return { configDir, outputDir };
}

function main() {
	const { configDir, outputDir } = parseArgs();

	const uiConfigPath = join(configDir, "console_ui.yaml");
	const fieldConfigPath = join(configDir, "console_field_metadata.yaml");

	if (!existsSync(uiConfigPath)) {
		console.error(`Console UI config not found: ${uiConfigPath}`);
		process.exit(1);
	}

	const uiConfig = load(readFileSync(uiConfigPath, "utf-8"));
	const fieldConfig = existsSync(fieldConfigPath)
		? load(readFileSync(fieldConfigPath, "utf-8"))
		: {};
	const workspaces = uiConfig.workspaces || {};
	const resources = uiConfig.resources || {};

	mkdirSync(outputDir, { recursive: true });

	console.log(`Source: ${uiConfigPath}`);
	console.log(`Resources: ${Object.keys(resources).length}`);
	console.log(`Workspaces: ${Object.keys(workspaces).length}`);
	console.log();

	// Map API kinds to catalog IDs (preserving established naming)
	const ID_OVERRIDES = {
		http_loadbalancer: "http-load-balancer",
		tcp_loadbalancer: "tcp-load-balancer",
		healthcheck: "health-check",
		route: "route-object",
	};

	let generated = 0;

	for (const [kind, config] of Object.entries(resources)) {
		const workspace = workspaces[config.workspace] || {};
		const fields = fieldConfig.resources?.[kind] || {};
		const id = ID_OVERRIDES[kind] || kind.replace(/_/g, "-");

		const doc = {
			schema: "urn:xcsh:console:resource:v1",
			id,
			label: config.menu_path?.[config.menu_path.length - 1] || id,
			_source: "Generated from api-specs-enriched/config/console_ui.yaml",

			api: {
				kind,
			},

			console: {
				workspace: config.workspace,
				workspace_label: workspace.label || "",
				route_prefix: workspace.route_prefix || "",
				route_pattern: config.route_pattern,
				menu_path: config.menu_path,
				breadcrumbs: config.breadcrumbs,
			},
		};

		if (config.namespace_scoped === false) {
			doc.console.namespace_scoped = false;
		}

		if (config.add_action) doc.add_action = config.add_action;
		if (config.save_action) doc.save_action = config.save_action;
		if (config.cancel_action) doc.cancel_action = config.cancel_action;
		if (config.form_tabs) doc.form_tabs = config.form_tabs;

		if (config.form_sections?.length) {
			doc.form = {
				sections: config.form_sections,
			};
		}

		// Add enriched field count
		const fieldCount = Object.keys(fields).length;
		if (fieldCount > 0) {
			doc.enriched_fields = {
				count: fieldCount,
				source: "api-specs-enriched/config/console_field_metadata.yaml",
			};
		}

		if (config.metadata) {
			doc.metadata = config.metadata;
		}

		const filename = `${id}.yaml`;
		const outputPath = join(outputDir, filename);
		const yaml = dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
		writeFileSync(outputPath, yaml);

		console.log(
			`  ${filename}: ${config.form_sections?.length || 0} sections, ${fieldCount} enriched fields`,
		);
		generated++;
	}

	console.log(`\n${generated} resource files generated in ${outputDir}`);
}

main();
