/**
 * Golden-diff test: the generator output must match the committed golden
 * snapshots for all non-hand-crafted workflows. This gates the generator
 * refactor (catalog-driven fieldToSteps). If any generated workflow drifts
 * from the golden, the test fails with a clear diff.
 *
 * To update goldens after an intentional generator change, run:
 *   bash test/update-goldens.sh
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const goldenDir = path.resolve(import.meta.dir, 'golden');
const catalogDir = path.resolve(import.meta.dir, '../catalog/workflows');

describe('golden-diff: generated workflows match committed snapshots', () => {
  const goldenFiles = fs.readdirSync(goldenDir).filter((f) => f.endsWith('-create.yaml'));
  for (const gf of goldenFiles) {
    const resource = gf.replace('-create.yaml', '');
    test(`${resource}/create matches golden`, () => {
      const goldenPath = path.join(goldenDir, gf);
      const currentPath = path.join(catalogDir, resource, 'create.yaml');
      if (!fs.existsSync(currentPath)) {
        // Resource was removed — skip (not a regression).
        return;
      }
      const golden = fs.readFileSync(goldenPath, 'utf-8').trim();
      const current = fs.readFileSync(currentPath, 'utf-8').trim();
      expect(current).toBe(golden);
    });
  }
});
