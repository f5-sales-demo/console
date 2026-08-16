#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "f5-sales-demo/api-specs-enriched";
const TARGET = "f5-sales-demo/console";
const EVENT_TYPE = "upstream-enrichment-changed";
const SEMVER = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DELIVERY_ID = /^[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const QUALIFIED_DIGEST = /^sha256:([0-9a-f]{64})$/;
const RECEIPT = /<!-- publication-receipt:(\{[^\n]*\}) -->/g;

function fail(message) {
	throw new Error(message);
}

function exactKeys(value, expected, name) {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${name} has unexpected fields`);
}

export function deliveryId(payload) {
	const identity = {
		commit: payload.target_commit,
		event_type: EVENT_TYPE,
		source: payload.trigger_source,
		tag: payload.release_tag,
		target: TARGET,
		version: payload.version,
	};
	return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function entryDeliveryId(entry) {
	return deliveryId({
		release_tag: entry.release_tag,
		target_commit: entry.target_commit,
		trigger_source: SOURCE,
		version: entry.version,
	});
}

export function validatePayload(payload) {
	exactKeys(
		payload,
		["delivery_id", "release_tag", "release_url", "target_commit", "trigger_source", "version"],
		"delivery payload",
	);
	if (!DELIVERY_ID.test(payload.delivery_id)) fail("delivery_id must be 64 lowercase hexadecimal characters");
	if (!SEMVER.test(payload.version) || payload.release_tag !== `v${payload.version}`) {
		fail("release_tag and version must be matching semantic versions");
	}
	if (!COMMIT.test(payload.target_commit)) fail("target_commit must be a full lowercase Git SHA");
	if (payload.trigger_source !== SOURCE) fail(`trigger_source must be ${SOURCE}`);
	if (payload.release_url !== `https://github.com/${SOURCE}/releases/tag/${payload.release_tag}`) {
		fail("release_url does not identify the dispatched release");
	}
	if (payload.delivery_id !== deliveryId(payload)) fail("delivery_id does not match the canonical identity");
	return payload;
}

export function validateLedger(ledger) {
	exactKeys(ledger, ["deliveries", "version"], "delivery ledger");
	if (ledger.version !== 1) fail("delivery ledger version must be 1");
	if (!ledger.deliveries || typeof ledger.deliveries !== "object" || Array.isArray(ledger.deliveries)) {
		fail("delivery ledger deliveries must be an object");
	}
	for (const [identifier, entry] of Object.entries(ledger.deliveries)) {
		if (!DELIVERY_ID.test(identifier)) fail("delivery ledger contains an invalid identifier");
		exactKeys(entry, ["release_tag", "target_commit", "version"], "delivery ledger entry");
		if (
			!SEMVER.test(entry.version) ||
			entry.release_tag !== `v${entry.version}` ||
			!COMMIT.test(entry.target_commit)
		) {
			fail("delivery ledger entry identity is malformed");
		}
		if (identifier !== entryDeliveryId(entry)) fail("delivery ledger identifier is not canonical");
	}
	return ledger;
}

function semverParts(version) {
	if (!SEMVER.test(version)) fail(`invalid semantic version: ${version}`);
	return version.split(".").map(Number);
}

function compareSemver(left, right) {
	const a = semverParts(left);
	const b = semverParts(right);
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] - b[index];
	}
	return 0;
}

function sameJson(left, right) {
	return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function validateState(ledger, pin) {
	validateLedger(ledger);
	const entries = Object.entries(ledger.deliveries);
	if (entries.length === 0) {
		if (pin !== null && pin !== undefined) fail("spec release pin exists without a completed delivery");
		return { currentDeliveryId: null };
	}
	if (pin === null || pin === undefined) fail("completed delivery ledger requires a current spec release pin");
	validatePin(pin);

	const tags = new Set();
	for (const [, entry] of entries) {
		if (tags.has(entry.release_tag)) fail("delivery ledger contains a duplicate release tag");
		tags.add(entry.release_tag);
	}
	const highest = entries.reduce((current, candidate) =>
		compareSemver(candidate[1].version, current[1].version) > 0 ? candidate : current,
	);
	const expected = {
		release_tag: pin.release_tag,
		target_commit: pin.target_commit,
		version: pin.version,
	};
	const currentDeliveryId = entryDeliveryId(expected);
	if (highest[0] !== currentDeliveryId || !sameJson(highest[1], expected)) {
		fail("current spec release pin does not match the newest completed delivery");
	}
	return { currentDeliveryId };
}

export function validateCurrentState(payload, ledger, pin) {
	validateState(ledger, pin);
	const expected = {
		release_tag: payload.release_tag,
		target_commit: payload.target_commit,
		version: payload.version,
	};
	const existing = ledger.deliveries[payload.delivery_id];
	if (existing !== undefined) {
		if (!sameJson(existing, expected)) fail("delivery ledger entry conflicts with payload");
		return { alreadyDelivered: true };
	}
	for (const entry of Object.values(ledger.deliveries)) {
		if (entry?.release_tag === payload.release_tag) fail("release tag was delivered under another identity");
	}
	if (pin) {
		validatePin(pin);
		if (compareSemver(payload.version, pin.version) < 0) fail("stale release cannot replace the current pin");
		if (payload.version === pin.version && payload.target_commit !== pin.target_commit) {
			fail("same release version cannot change target commit");
		}
	}
	return { alreadyDelivered: false };
}

export function validateTransition(baseLedger, basePin, ledger, pin) {
	const emptyLedger = { deliveries: {}, version: 1 };
	const before = baseLedger ?? emptyLedger;
	validateState(before, basePin);
	const afterState = validateState(ledger, pin);

	for (const [identifier, entry] of Object.entries(before.deliveries)) {
		if (!sameJson(ledger.deliveries[identifier], entry)) fail("delivery ledger entries are immutable");
	}
	const additions = Object.keys(ledger.deliveries).filter((identifier) => before.deliveries[identifier] === undefined);
	if (sameJson(basePin, pin)) {
		if (additions.length !== 0) fail("delivery ledger changed without advancing the spec release pin");
		return;
	}
	if (pin === null || pin === undefined) fail("spec release pin cannot be removed");
	if (basePin && compareSemver(pin.version, basePin.version) <= 0) {
		fail("spec release pin transition must advance semantic version");
	}
	if (additions.length !== 1 || additions[0] !== afterState.currentDeliveryId) {
		fail("spec release pin transition requires exactly one matching delivery addition");
	}
}

export function publicationReceipt(release, payload, resolvedCommit) {
	if (resolvedCommit !== payload.target_commit) fail("release tag does not resolve to target_commit");
	if (release.draft || release.prerelease) fail("release must be published and non-prerelease");
	if (release.tag_name !== payload.release_tag) fail("release endpoint returned another tag");
	const expectedNames = [
		"api-catalog.json",
		`f5xc-api-specs-${payload.release_tag}.zip`,
		"index.json",
		"minimal-export-defaults.json",
		"openapi.json",
	].sort();
	const actualNames = (release.assets ?? []).map((asset) => asset?.name).sort();
	if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) fail("release asset set is not exact");
	const matches = [...String(release.body ?? "").matchAll(RECEIPT)];
	if (matches.length !== 1) fail("release must contain exactly one publication receipt");
	let receipt;
	try {
		receipt = JSON.parse(matches[0][1]);
	} catch {
		fail("publication receipt is not valid JSON");
	}
	exactKeys(receipt, ["assets", "commit", "version"], "publication receipt");
	if (receipt.version !== payload.version || receipt.commit !== payload.target_commit) {
		fail("publication receipt identity differs from payload");
	}
	exactKeys(receipt.assets, expectedNames, "publication receipt assets");
	const assets = {};
	for (const [name, digest] of Object.entries(receipt.assets)) {
		const match = typeof digest === "string" ? QUALIFIED_DIGEST.exec(digest) : null;
		if (!match) fail("publication receipt contains an invalid asset digest");
		assets[name] = match[1];
	}
	for (const asset of release.assets) {
		if (asset.digest !== receipt.assets[asset.name]) {
			fail(`release asset digest differs from publication receipt: ${asset.name}`);
		}
	}
	return { ...receipt, assets };
}

export function validatePin(pin) {
	exactKeys(pin, ["assets", "release_tag", "target_commit", "version"], "spec release pin");
	if (!SEMVER.test(pin.version) || pin.release_tag !== `v${pin.version}` || !COMMIT.test(pin.target_commit)) {
		fail("spec release pin identity is malformed");
	}
	const expectedNames = [
		"api-catalog.json",
		`f5xc-api-specs-${pin.release_tag}.zip`,
		"index.json",
		"minimal-export-defaults.json",
		"openapi.json",
	];
	exactKeys(pin.assets, expectedNames, "spec release pin assets");
	if (Object.values(pin.assets).some((digest) => !DIGEST.test(digest))) fail("spec release pin digest is malformed");
	return pin;
}

function atomicJson(path, document) {
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function payloadFromEnvironment() {
	return validatePayload({
		delivery_id: process.env.DELIVERY_ID,
		release_tag: process.env.RELEASE_TAG,
		release_url: process.env.RELEASE_URL,
		target_commit: process.env.TARGET_COMMIT,
		trigger_source: process.env.TRIGGER_SOURCE,
		version: process.env.RELEASE_VERSION,
	});
}

function main() {
	const [command, ...args] = process.argv.slice(2);
	if (command === "preflight") {
		const [ledgerPath, pinPath] = args;
		const payload = payloadFromEnvironment();
		const ledger = validateLedger(readJson(ledgerPath));
		const pin = pinPath && readFileOrNull(pinPath);
		const state = validateCurrentState(payload, ledger, pin);
		process.stdout.write(state.alreadyDelivered ? "false" : "true");
		return;
	}
	if (command === "validate-release") {
		const [releasePath, commitPath, candidatePath] = args;
		const payload = payloadFromEnvironment();
		const release = readJson(releasePath);
		const resolvedCommit = readFileSync(commitPath, "utf8").trim();
		const receipt = publicationReceipt(release, payload, resolvedCommit);
		atomicJson(candidatePath, {
			assets: receipt.assets,
			release_tag: payload.release_tag,
			target_commit: payload.target_commit,
			version: payload.version,
		});
		return;
	}
	if (command === "validate-pin-release") {
		const [releasePath, commitPath, pinPath] = args;
		const pin = validatePin(readJson(pinPath));
		const payload = validatePayload({
			delivery_id: entryDeliveryId(pin),
			release_tag: pin.release_tag,
			release_url: `https://github.com/${SOURCE}/releases/tag/${pin.release_tag}`,
			target_commit: pin.target_commit,
			trigger_source: SOURCE,
			version: pin.version,
		});
		const receipt = publicationReceipt(
			readJson(releasePath),
			payload,
			readFileSync(commitPath, "utf8").trim(),
		);
		if (!sameJson(receipt.assets, pin.assets)) fail("tracked spec release pin differs from publication receipt");
		return;
	}
	if (command === "validate-state") {
		const [ledgerPath, pinPath] = args;
		validateState(readJson(ledgerPath), readFileOrNull(pinPath));
		return;
	}
	if (command === "validate-transition") {
		const [baseLedgerPath, basePinPath, ledgerPath, pinPath] = args;
		validateTransition(
			readFileOrNull(baseLedgerPath),
			readFileOrNull(basePinPath),
			readJson(ledgerPath),
			readFileOrNull(pinPath),
		);
		return;
	}
	if (command === "complete") {
		const [ledgerPath, candidatePath] = args;
		const payload = payloadFromEnvironment();
		const ledger = validateLedger(readJson(ledgerPath));
		const pin = validatePin(readJson(candidatePath));
		if (
			pin.release_tag !== payload.release_tag ||
			pin.target_commit !== payload.target_commit ||
			pin.version !== payload.version
		) {
			fail("candidate pin differs from payload");
		}
		const existing = ledger.deliveries[payload.delivery_id];
		const entry = {
			release_tag: payload.release_tag,
			target_commit: payload.target_commit,
			version: payload.version,
		};
		if (existing !== undefined && !sameJson(existing, entry)) fail("delivery ledger entry conflicts with payload");
		for (const [identifier, delivered] of Object.entries(ledger.deliveries)) {
			if (identifier !== payload.delivery_id && delivered.release_tag === payload.release_tag) {
				fail("release tag was delivered under another identity");
			}
			if (compareSemver(delivered.version, payload.version) >= 0 && identifier !== payload.delivery_id) {
				fail("candidate delivery does not advance the completed ledger");
			}
		}
		ledger.deliveries[payload.delivery_id] = entry;
		validateState(ledger, pin);
		atomicJson(ledgerPath, ledger);
		return;
	}
	fail(
		"usage: spec-delivery.mjs <preflight|validate-release|validate-pin-release|validate-state|validate-transition|complete> ...",
	);
}

function readFileOrNull(path) {
	try {
		return readJson(path);
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		main();
	} catch (error) {
		console.error(`spec delivery: ${error.message}`);
		process.exit(1);
	}
}
