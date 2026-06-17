#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const CATALOG_DIR = join(ROOT, "catalog");

function walkYaml(dir) {
	const results = [];
	if (!statSync(dir, { throwIfNoEntry: false })) return results;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkYaml(full));
		} else if (
			extname(entry.name) === ".yaml" ||
			extname(entry.name) === ".yml"
		) {
			results.push(full);
		}
	}
	return results;
}

function loadYaml(path) {
	return load(readFileSync(path, "utf-8"));
}

function main() {
	const warnings = [];

	const resourceFiles = walkYaml(join(CATALOG_DIR, "resources"));
	const _workflowFiles = walkYaml(join(CATALOG_DIR, "workflows"));
	const routeFiles = walkYaml(join(CATALOG_DIR, "routes"));

	const resourceIds = new Set();
	const _workflowPaths = new Set();
	const routePaths = new Set();

	for (const f of resourceFiles) {
		const data = loadYaml(f);
		if (data?.id) resourceIds.add(data.id);
		if (data?.workflows) {
			for (const wf of Object.values(data.workflows)) {
				const fullPath = join(CATALOG_DIR, wf);
				if (!existsSync(fullPath)) {
					warnings.push(
						`${relative(ROOT, f)}: workflow ref "${wf}" does not exist`,
					);
				}
			}
		}
		if (data?.console?.list_route) {
			const fullPath = join(CATALOG_DIR, data.console.list_route);
			if (!existsSync(fullPath)) {
				warnings.push(
					`${relative(ROOT, f)}: list_route ref "${data.console.list_route}" does not exist`,
				);
			}
		}
	}

	for (const f of routeFiles) {
		const data = loadYaml(f);
		const rel = relative(ROOT, f);
		routePaths.add(relative(CATALOG_DIR, f));
		if (
			data?.screen?.primary_resource &&
			!resourceIds.has(data.screen.primary_resource)
		) {
			warnings.push(
				`${rel}: primary_resource "${data.screen.primary_resource}" has no resource file`,
			);
		}
		if (data?.operations) {
			for (const op of data.operations) {
				if (op.workflow) {
					const fullPath = join(CATALOG_DIR, op.workflow);
					if (!existsSync(fullPath)) {
						warnings.push(
							`${rel}: workflow ref "${op.workflow}" does not exist`,
						);
					}
				}
			}
		}
	}

	const navFile = join(CATALOG_DIR, "navigation", "console-tree.yaml");
	if (existsSync(navFile)) {
		const nav = loadYaml(navFile);
		function checkNavRefs(nodes) {
			for (const node of nodes || []) {
				if (node.route_file) {
					const fullPath = join(CATALOG_DIR, node.route_file);
					if (!existsSync(fullPath)) {
						warnings.push(
							`console-tree.yaml: route_file "${node.route_file}" does not exist`,
						);
					}
				}
				if (node.children) checkNavRefs(node.children);
			}
		}
		checkNavRefs(nav?.tree);
	}

	if (warnings.length === 0) {
		console.log("Lint passed — no orphan references or missing files.");
	} else {
		console.log("Lint warnings:");
		for (const w of warnings) {
			console.log(`  WARN  ${w}`);
		}
	}

	console.log(`\n${warnings.length} warning(s)`);
	process.exit(warnings.length > 0 ? 1 : 0);
}

main();
