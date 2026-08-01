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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
	if (!existsSync(fieldConfigPath)) {
		console.error(`Console field metadata not found: ${fieldConfigPath}`);
		process.exit(1);
	}

	const uiConfig = load(readFileSync(uiConfigPath, "utf-8"));
	const fieldConfig = load(readFileSync(fieldConfigPath, "utf-8"));
	if (!isObject(uiConfig) || !isObject(uiConfig.workspaces) || !isObject(uiConfig.resources)) {
		throw new Error("console_ui.yaml must contain object-valued workspaces and resources");
	}
	if (!isObject(fieldConfig) || !isObject(fieldConfig.resources)) {
		throw new Error("console_field_metadata.yaml must contain an object-valued resources map");
	}
	const workspaces = uiConfig.workspaces;
	const resources = uiConfig.resources;
	for (const [name, workspace] of Object.entries(workspaces)) {
		if (!isObject(workspace) || !nonEmptyString(workspace.label) || typeof workspace.route_prefix !== "string") {
			throw new Error(`workspace ${name} must define label and route_prefix`);
		}
	}
	for (const [kind, fields] of Object.entries(fieldConfig.resources)) {
		if (!Object.hasOwn(resources, kind)) {
			throw new Error(`field metadata references unknown resource: ${kind}`);
		}
		// The upstream contract uses null for a known resource with no enriched fields.
		if (fields !== null && !isObject(fields)) throw new Error(`field metadata for ${kind} must be an object or null`);
	}

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

	const documents = [];
	const filenames = new Map();

	for (const [kind, config] of Object.entries(resources)) {
		if (!/^[a-z0-9_]+$/.test(kind)) throw new Error(`resource kind is not filename-safe: ${kind}`);
		if (!isObject(config)) throw new Error(`resource ${kind} must be an object`);
		if (typeof config.workspace !== "string" || !Object.hasOwn(workspaces, config.workspace)) {
			throw new Error(`resource ${kind} references unknown workspace: ${config.workspace}`);
		}
		const workspace = workspaces[config.workspace];
		if (
			!nonEmptyString(config.route_pattern) ||
			!nonEmptyStringArray(config.menu_path) ||
			!nonEmptyStringArray(config.breadcrumbs)
		) {
			throw new Error(`resource ${kind} must define route_pattern, menu_path, and breadcrumbs`);
		}
		const fields = fieldConfig.resources[kind] || {};
		const id = ID_OVERRIDES[kind] || kind.replace(/_/g, "-");
		const filename = `${id}.yaml`;
		if (filenames.has(filename)) {
			throw new Error(`resource filename collision: ${filenames.get(filename)} and ${kind} both map to ${filename}`);
		}
		filenames.set(filename, kind);

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

		const yaml = `---\n${dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })}`;
		documents.push({ filename, yaml });

		console.log(
			`  ${filename}: ${config.form_sections?.length || 0} sections, ${fieldCount} enriched fields`,
		);
	}

	if (documents.length !== Object.keys(resources).length) {
		throw new Error("generated resource count differs from source resource count");
	}
	replaceOutput(outputDir, documents);
	console.log(`\n${documents.length} resource files generated in ${outputDir}`);
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStringArray(value) {
	return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function replaceOutput(outputDir, documents) {
	const parent = dirname(outputDir);
	mkdirSync(parent, { recursive: true });
	const candidate = mkdtempSync(join(parent, ".console-resources-"));
	try {
		for (const { filename, yaml } of documents) writeFileSync(join(candidate, filename), yaml);
		rmSync(outputDir, { recursive: true, force: true });
		renameSync(candidate, outputDir);
	} catch (error) {
		rmSync(candidate, { recursive: true, force: true });
		throw error;
	}
}

main();
