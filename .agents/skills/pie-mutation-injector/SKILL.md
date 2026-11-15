---
name: pie-mutation-injector
description: >-
  Injects controlled and randomized defect mutations across the real-world testbed repositories.
  Supports locator drift, strict-mode ambiguity, jQuery container drift, and backend 500 crashes
  for verifying both healing and negative control abstentions.
---

# PIE Mutation Injector Skill

Use this skill to introduce realistic defect mutations into testbed repositories for benchmarking PIE without manual spec editing.

## Supported Mutation Types

### 1. Locator Drift (Semantic Renaming)
* **Target:** Single-target locators (buttons, links, inputs).
* **Mutation Pattern:** Change ID, data-test, or class to an obsolete name (e.g. `shopping_cart_link` -> `shopping_cart_container_broken`).
* **Expected PIE Behavior:** Tier 1 AST Fast-Path or Tier 2 Semantic LLM heals the locator using live DOM or snapshot evidence.

### 2. Strict-Mode Ambiguity (Multi-Match Collision)
* **Target:** Elements with generic class names matching multiple items on the page (e.g. `.btn_inventory` matching 6 items).
* **Expected PIE Behavior:** Disambiguates using accessible name (`getByRole('button', { name: 'Add to cart' })`) or spatial hierarchy.

### 3. Custom / Obscured Widget Drift (Select2 Dropdown)
* **Target:** Hidden `<select>` widgets obscured by overlay containers (e.g. `span.select2-container`).
* **Expected PIE Behavior:** Selects the visible combobox trigger rather than attempting to click the zero-sized native `<select>`.

### 4. Gate 0 Negative Control (Backend 500 Injection)
* **Target:** API routes called during test actions (e.g. POST `/api/room` or `/api/auth`).
* **Mutation Pattern:** Return HTTP 500 or simulate server crash.
* **Expected PIE Behavior:** **STRICT ABSTENTION**. Gate 0 must not touch locators or assertions, and must file a defect ticket via `pw-intel report-defect`.

## Rollback Procedure

Always cleanly revert testbed mutations before switching test modes:
```powershell
git checkout -- .
git clean -fd
```
