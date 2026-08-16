import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  deliveryId,
  publicationReceipt,
  validateCurrentState,
  validateLedger,
  validatePayload,
  validateState,
  validateTransition,
} from '../tools/spec-delivery.mjs';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function payload(overrides = {}) {
  const value = {
    delivery_id: '',
    release_tag: 'v2.1.208',
    release_url: 'https://github.com/f5-sales-demo/api-specs-enriched/releases/tag/v2.1.208',
    target_commit: commit,
    trigger_source: 'f5-sales-demo/api-specs-enriched',
    version: '2.1.208',
    ...overrides,
  };
  value.delivery_id = overrides.delivery_id ?? deliveryId(value);
  return value;
}

function receiptAssets() {
  return {
    'api-catalog.json': digest,
    'f5xc-api-specs-v2.1.208.zip': digest,
    'index.json': digest,
    'minimal-export-defaults.json': digest,
    'openapi.json': digest,
  };
}

function release(body) {
  return {
    assets: Object.keys(receiptAssets()).map((name) => ({ digest: `sha256:${digest}`, name })),
    body,
    draft: false,
    prerelease: false,
    tag_name: 'v2.1.208',
  };
}

test('canonical delivery identity rejects forged input', () => {
  const valid = payload();
  assert.equal(valid.delivery_id, '210409f1df5983a22f35a515e68b94bed734d35e1a347a048ae2d24b9000ea16');
  assert.equal(validatePayload(valid), valid);
  assert.throws(() => validatePayload({ ...valid, delivery_id: '0'.repeat(64) }), /canonical identity/);
  assert.throws(() => validatePayload({ ...valid, trigger_source: 'another/repository' }), /trigger_source/);
});

test('publication receipt binds exact tag, commit, and five asset hashes', () => {
  const validPayload = payload();
  const receipt = {
    assets: Object.fromEntries(Object.entries(receiptAssets()).map(([name, value]) => [name, `sha256:${value}`])),
    commit,
    version: '2.1.208',
  };
  const document = release(`notes\n\n<!-- publication-receipt:${JSON.stringify(receipt)} -->`);
  assert.deepEqual(publicationReceipt(document, validPayload, commit), {
    assets: receiptAssets(),
    commit,
    version: '2.1.208',
  });
  assert.throws(() => publicationReceipt(document, validPayload, 'c'.repeat(40)), /does not resolve/);
  assert.throws(
    () => publicationReceipt({ ...document, body: `${document.body}\n${document.body}` }, validPayload, commit),
    /exactly one/,
  );
  const corrupt = structuredClone(document);
  corrupt.assets[0].digest = `sha256:${'c'.repeat(64)}`;
  assert.throws(() => publicationReceipt(corrupt, validPayload, commit), /asset digest differs/);

  for (const invalidDigest of [digest, `sha512:${digest}`]) {
    const invalidReceipt = structuredClone(receipt);
    invalidReceipt.assets['api-catalog.json'] = invalidDigest;
    const invalid = release(`<!-- publication-receipt:${JSON.stringify(invalidReceipt)} -->`);
    assert.throws(() => publicationReceipt(invalid, validPayload, commit), /invalid asset digest/);
  }
});

test('completed, conflicting, and stale deliveries fail closed', () => {
  const validPayload = payload();
  const entry = { release_tag: 'v2.1.208', target_commit: commit, version: '2.1.208' };
  const complete = { deliveries: { [validPayload.delivery_id]: entry }, version: 1 };
  const currentPin = { assets: receiptAssets(), ...entry };
  assert.deepEqual(validateCurrentState(validPayload, complete, currentPin), { alreadyDelivered: true });
  const reordered = { version: entry.version, target_commit: entry.target_commit, release_tag: entry.release_tag };
  assert.deepEqual(
    validateCurrentState(
      validPayload,
      { deliveries: { [validPayload.delivery_id]: reordered }, version: 1 },
      currentPin,
    ),
    { alreadyDelivered: true },
  );
  assert.throws(
    () =>
      validateCurrentState(
        validPayload,
        { deliveries: { [validPayload.delivery_id]: { ...entry, target_commit: 'c'.repeat(40) } }, version: 1 },
        currentPin,
      ),
    /canonical|conflicts/,
  );
  const newerAssets = receiptAssets();
  delete newerAssets['f5xc-api-specs-v2.1.208.zip'];
  newerAssets['f5xc-api-specs-v2.1.209.zip'] = digest;
  const newerPin = { assets: newerAssets, release_tag: 'v2.1.209', target_commit: commit, version: '2.1.209' };
  const newerPayload = payload({ release_tag: 'v2.1.209', version: '2.1.209' });
  const newerEntry = { release_tag: 'v2.1.209', target_commit: commit, version: '2.1.209' };
  const newerLedger = { deliveries: { [newerPayload.delivery_id]: newerEntry }, version: 1 };
  assert.throws(() => validateCurrentState(validPayload, newerLedger, newerPin), /stale release/);
});

test('ledger contract rejects additional fields', () => {
  assert.throws(() => validateLedger({ deliveries: {}, version: 1, accepted: true }), /unexpected fields/);
  const entry = { release_tag: 'v2.1.208', target_commit: commit, version: '2.1.208' };
  assert.throws(
    () => validateLedger({ deliveries: { ['f'.repeat(64)]: entry }, version: 1 }),
    /identifier is not canonical/,
  );
});

test('ledger, pin, and transition remain one append-only canonical state', () => {
  const firstPayload = payload();
  const firstEntry = { release_tag: firstPayload.release_tag, target_commit: commit, version: firstPayload.version };
  const firstLedger = { deliveries: { [firstPayload.delivery_id]: firstEntry }, version: 1 };
  const firstPin = { assets: receiptAssets(), ...firstEntry };
  assert.deepEqual(validateState(firstLedger, firstPin), { currentDeliveryId: firstPayload.delivery_id });
  validateTransition({ deliveries: {}, version: 1 }, null, firstLedger, firstPin);
  assert.throws(() => validateState(firstLedger, null), /requires a current spec release pin/);
  assert.throws(
    () => validateTransition(firstLedger, firstPin, { deliveries: {}, version: 1 }, null),
    /pin cannot be removed|immutable/,
  );
  assert.throws(
    () =>
      validateTransition(
        firstLedger,
        firstPin,
        { deliveries: { ...firstLedger.deliveries, ['c'.repeat(64)]: firstEntry }, version: 1 },
        firstPin,
      ),
    /canonical|without advancing/,
  );
});

test('workflow publishes ledger only with the generated catalog PR', () => {
  const workflow = readFileSync(new URL('../.github/workflows/regenerate-catalog.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Checkout console[\s\S]*?ref: main/);
  assert.match(workflow, /ref: \$\{\{ steps\.delivery\.outputs\.target_commit \}\}/);
  assert.match(workflow, /find catalog\/resources -mindepth 1 -delete/);
  assert.match(workflow, /shasum -a 256/);
  assert.match(workflow, /git add catalog\/resources tools\/spec-deliveries\.json tools\/spec-release\.json/);
});

test('workflow retries reuse the exact PR and issue before re-enabling auto-merge', () => {
  const workflow = readFileSync(new URL('../.github/workflows/regenerate-catalog.yml', import.meta.url), 'utf8');
  const existingPull = workflow.indexOf('if [ -n "$EXISTING_PR" ]');
  const createIssue = workflow.indexOf('ISSUE_URL=$(gh issue create');
  const enableMerge = workflow.lastIndexOf('gh pr merge "$PR_NUMBER" --squash --auto --delete-branch');
  assert.ok(existingPull >= 0 && createIssue > existingPull && enableMerge > createIssue);
  assert.doesNotMatch(workflow.slice(existingPull, createIssue), /exit 0/);
  assert.match(workflow, /gh issue list --state all/);
  assert.match(workflow, /Existing delivery pull request does not target main/);
  assert.match(workflow, /Another spec delivery pull request is still open/);
});

test('required validation measures state, release bytes, and exact deterministic generation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/validate-catalog.yml', import.meta.url), 'utf8');
  assert.match(workflow, /validate-transition/);
  assert.match(workflow, /validate-pin-release/);
  assert.match(workflow, /shasum -a 256/);
  assert.match(workflow, /checkout --quiet --detach "\$TARGET_COMMIT"/);
  assert.match(workflow, /diff -ru "\$GENERATED" "\$GENERATED_AGAIN"/);
  assert.match(workflow, /diff -ru catalog\/resources "\$GENERATED"/);
  assert.match(workflow, /group: validate-catalog-\$\{\{ github\.ref \}\}/);
});
