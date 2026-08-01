import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('generation replaces stale YAML and is byte deterministic', () => {
  const root = mkdtempSync(join(tmpdir(), 'console-generator-'));
  const config = join(root, 'config');
  const output = join(root, 'output');
  mkdirSync(config);
  mkdirSync(output);
  writeFileSync(
    join(config, 'console_ui.yaml'),
    `workspaces:
  sample:
    label: Sample
    route_prefix: /sample
resources:
  sample_resource:
    workspace: sample
    route_pattern: /sample
    menu_path: [Sample]
    breadcrumbs: [Home, Sample]
`,
  );
  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources: {}\n');
  writeFileSync(join(output, 'stale.yaml'), 'stale: true\n');
  writeFileSync(join(output, 'stale.yml'), 'stale: true\n');
  writeFileSync(join(output, 'stale.txt'), 'stale\n');
  mkdirSync(join(output, 'nested'));
  writeFileSync(join(output, 'nested', 'stale.yaml'), 'stale: true\n');

  const script = new URL('../tools/generate-from-enriched.mjs', import.meta.url);
  const args = [script.pathname, '--config-dir', config, '--output-dir', output];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.throws(() => readFileSync(join(output, 'stale.yaml')), /ENOENT/);
  assert.equal(existsSync(join(output, 'stale.yml')), false);
  assert.equal(existsSync(join(output, 'stale.txt')), false);
  assert.equal(existsSync(join(output, 'nested')), false);
  assert.deepEqual(readdirSync(output), ['sample-resource.yaml']);
  const expected = readFileSync(join(output, 'sample-resource.yaml'), 'utf8');

  const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(join(output, 'sample-resource.yaml'), 'utf8'), expected);
});

test('generation rejects filename collisions instead of silently losing a resource', () => {
  const root = mkdtempSync(join(tmpdir(), 'console-generator-collision-'));
  const config = join(root, 'config');
  const output = join(root, 'output');
  mkdirSync(config);
  writeFileSync(
    join(config, 'console_ui.yaml'),
    `workspaces:
  sample: {label: Sample, route_prefix: /sample}
resources:
  healthcheck:
    workspace: sample
    route_pattern: /one
    menu_path: [One]
    breadcrumbs: [Home, One]
  health_check:
    workspace: sample
    route_pattern: /two
    menu_path: [Two]
    breadcrumbs: [Home, Two]
`,
  );
  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources: {}\n');

  const result = generate(config, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /filename collision/);
  assert.equal(existsSync(output), false);
});

test('generation requires complete config and valid workspace references', () => {
  const root = mkdtempSync(join(tmpdir(), 'console-generator-config-'));
  const config = join(root, 'config');
  const output = join(root, 'output');
  mkdirSync(config);
  writeFileSync(
    join(config, 'console_ui.yaml'),
    `workspaces: {}
resources:
  sample:
    workspace: absent
    route_pattern: /sample
    menu_path: [Sample]
    breadcrumbs: [Home, Sample]
`,
  );

  let result = generate(config, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /field metadata not found/);

  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources: {}\n');
  result = generate(config, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown workspace/);
  assert.equal(existsSync(output), false);
});

test('generation validates every workspace and rejects orphan field metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'console-generator-strict-config-'));
  const config = join(root, 'config');
  const output = join(root, 'output');
  mkdirSync(config);
  writeFileSync(
    join(config, 'console_ui.yaml'),
    `workspaces:
  used: {label: Used, route_prefix: /used}
  unused: {label: ''}
resources:
  sample:
    workspace: used
    route_pattern: /sample
    menu_path: [Sample]
    breadcrumbs: [Home, Sample]
`,
  );
  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources: {}\n');

  let result = generate(config, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /workspace unused must define label and route_prefix/);
  assert.equal(existsSync(output), false);

  writeFileSync(
    join(config, 'console_ui.yaml'),
    `workspaces:
  used: {label: Used, route_prefix: /used}
resources:
  sample:
    workspace: used
    route_pattern: /sample
    menu_path: [Sample]
    breadcrumbs: [Home, Sample]
`,
  );
  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources:\n  orphan: invalid\n');

  result = generate(config, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /field metadata references unknown resource: orphan/);
  assert.equal(existsSync(output), false);

  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources:\n  sample: null\n');
  result = generate(config, output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(output, 'sample.yaml')), true);

  writeFileSync(join(config, 'console_field_metadata.yaml'), 'resources:\n  sample: invalid\n');
  result = generate(config, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /field metadata for sample must be an object or null/);
});

function generate(config, output) {
  const script = new URL('../tools/generate-from-enriched.mjs', import.meta.url);
  return spawnSync(process.execPath, [script.pathname, '--config-dir', config, '--output-dir', output], {
    encoding: 'utf8',
  });
}
