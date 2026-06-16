# Console Catalog

Schema-driven inventory of the F5 Distributed Cloud administration console UI — routes, resources, workflows, and browser automation manifests.

[![Validate Catalog](https://github.com/f5xc-salesdemos/console/actions/workflows/validate-catalog.yml/badge.svg)](https://github.com/f5xc-salesdemos/console/actions/workflows/validate-catalog.yml)

## Purpose

This repository maps API resources to their console UI locations, navigation paths, form structures, and step-by-step browser automation workflows. The catalog is consumed by [xcsh](https://github.com/f5xc-salesdemos/xcsh) to power demos, training videos, UAT/QA automation, and AI-assisted UI navigation.

## Structure

```
catalog/
├── navigation/     # Console menu tree (sitemap)
├── routes/         # Screen definitions at each console URL
├── resources/      # API-to-console traceability matrix
└── workflows/      # Step-by-step browser automation sequences
```

## Validation

```bash
npm install
npm run validate   # JSON Schema validation
npm run lint       # Cross-reference checks
```

## Documentation

- [Architecture](docs/architecture.md) — four-layer model overview
- [Ontology](docs/ontology.md) — term definitions
- [Schema Guide](docs/schema-guide.md) — how to author catalog entries
- [Discovery Guide](docs/discovery-guide.md) — browser-first catalog population
