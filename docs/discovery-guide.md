# Discovery Guide

How the xcsh browser automation tool populates the catalog by crawling the F5 XC console.

## Overview

Catalog entries are authored using a **browser-first discovery** approach:

1. xcsh connects to the user's Chrome browser (via CDP on port 9222)
2. xcsh navigates the console and extracts structural information
3. xcsh outputs YAML files matching the catalog schemas
4. A human reviews, refines, and commits the entries

## Prerequisites

### Chrome Setup

Launch Chrome with remote debugging enabled:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.config/xcsh/browser-profiles/xcsh"
```

Log into the F5 XC console manually. Cookies persist in the user-data-dir.

### xcsh Setup

xcsh must have the console catalog repository checked out and accessible. Discovery skills output YAML files to the catalog directory.

## Discovery Workflow

### Phase 1: Navigation Tree

The `console-discover` skill crawls the console sidebar menu and extracts:
- Menu labels and hierarchy
- Route URLs for each menu item
- Icon identifiers

Output: updates to `catalog/navigation/console-tree.yaml`

### Phase 2: Route Inspection

For each route in the navigation tree, the `console-inspect` skill:
- Navigates to the URL
- Identifies the screen type (list, detail, form, dashboard)
- Extracts table columns and row actions (for list screens)
- Extracts form sections and fields (for form screens)
- Identifies available controls (buttons, search, filters)
- Captures stable selectors (`data-testid`, ARIA labels)

Output: YAML files in `catalog/routes/`

### Phase 3: Resource Mapping

From route and form data, combined with API spec cross-referencing:
- Match console screens to API resource kinds
- Map form fields to API schema fields
- Identify CRUD endpoint coverage

Output: YAML files in `catalog/resources/`

### Phase 4: Workflow Generation

From form metadata and control selectors:
- Generate step-by-step automation workflows
- Include navigation, form filling, and save actions
- Add assertion steps for verification

Output: YAML files in `catalog/workflows/`

## Validation After Discovery

After each discovery run:

1. Run `npm run validate` to check schema compliance
2. Review generated entries for accuracy
3. Adjust confidence levels
4. Commit and push via the standard PR workflow

## Re-Discovery

When the console UI changes:
1. Re-run discovery for affected routes
2. Compare against existing entries
3. Mark changed entries as updated, unchanged entries retain their confidence
4. Review and commit changes
