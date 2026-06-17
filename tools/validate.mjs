#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { load } from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const SCHEMA_DIR = join(ROOT, "schemas");
const _CATALOG_DIR = join(ROOT, "catalog");

const SCHEMA_MAP = {
  "catalog/navigation": "navigation.schema.json",
  "catalog/routes": "route.schema.json",
  "catalog/resources": "resource.schema.json",
  "catalog/workflows": "workflow.schema.json",
};

function loadSchema(name) {
  const path = join(SCHEMA_DIR, name);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function walkYaml(dir) {
  const results = [];
  if (!statSync(dir, { throwIfNoEntry: false })) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYaml(full));
    } else if (extname(entry.name) === ".yaml" || extname(entry.name) === ".yml") {
      results.push(full);
    }
  }
  return results;
}

function _resolveSchemaFile(filePath) {
  const rel = relative(ROOT, filePath);
  for (const [prefix, schema] of Object.entries(SCHEMA_MAP)) {
    if (rel.startsWith(prefix)) return schema;
  }
  return null;
}

function main() {
  const commonSchema = loadSchema("common.schema.json");
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(commonSchema, "common.schema.json");

  let totalFiles = 0;
  let totalErrors = 0;
  const errors = [];

  for (const [prefix, schemaFile] of Object.entries(SCHEMA_MAP)) {
    const schema = loadSchema(schemaFile);
    const validate = ajv.compile(schema);
    const dir = join(ROOT, prefix);
    const files = walkYaml(dir);

    for (const file of files) {
      totalFiles++;
      const rel = relative(ROOT, file);

      let data;
      try {
        data = load(readFileSync(file, "utf-8"));
      } catch (err) {
        errors.push({ file: rel, error: `YAML parse error: ${err.message}` });
        totalErrors++;
        continue;
      }

      const valid = validate(data);
      if (!valid) {
        for (const err of validate.errors) {
          errors.push({
            file: rel,
            error: `${err.instancePath || "/"}: ${err.message}`,
          });
        }
        totalErrors += validate.errors.length;
      } else {
        console.log(`  PASS  ${rel}`);
      }
    }
  }

  console.log("");
  if (errors.length > 0) {
    console.log("Validation errors:");
    for (const { file, error } of errors) {
      console.log(`  FAIL  ${file}: ${error}`);
    }
  }

  console.log(`\n${totalFiles} files checked, ${totalErrors} error(s)`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
