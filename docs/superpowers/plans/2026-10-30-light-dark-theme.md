# Light and Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent light/dark theme toggle to the FactoryOS app, retaining dark as the default.

**Architecture:** Keep the existing vanilla TypeScript app and stylesheet. Put color tokens in CSS custom properties, select the active palette through `data-theme` on the root element, and keep small theme parsing/toggling helpers in a testable TypeScript module. A header button immediately before the “LOCAL / WINDOWS” badge updates the root theme and `localStorage`.

**Tech Stack:** TypeScript, CSS, Node.js test runner with `tsx`; no added dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-light-dark-theme-design.md`

## Global Constraints

- Preserve the current dark theme as the initial/default appearance.
- Persist the user-selected theme in browser `localStorage`.
- Place an accessible sun/moon toggle immediately to the left of the “LOCAL / WINDOWS” badge.
- Use CSS variables for both palettes; add no dependencies.
- Do not add OS-preference detection or server-side preference storage.

## Review Focus

- Missing or invalid saved preference must resolve to dark; test `theme.test.mjs`.
- Storage access can throw (for example, restricted browser storage); test the fallback in `theme.test.mjs`.
- Toggling must alternate light/dark and persist the selected value; test the theme helper and verify DOM wiring.
- Button accessible name and sun/moon icon must stay synchronized with the available action; verify via DOM wiring and browser check.
- Light palette must override all semantic foreground, background, border, and status colors while dark tokens preserve the current appearance; verify CSS token coverage and inspect both themes in browser.

---

### Task 1: Add the persistent theme toggle

**Files:**
- Create: `web/theme.ts` — theme type, storage key, safe initial-theme reader, and next-theme helper.
- Create: `tests/theme.test.mjs` — unit tests for initial theme and toggling behavior.
- Modify: `web/main.ts` — apply initial theme and add accessible toggle next to the brand.
- Modify: `web/style.css` — map existing dark colors to CSS variables and define the light palette.
- Create: `tests/theme-wiring.test.mjs` — assert the app wires the theme helpers, persistence, accessible control, and CSS palettes.
- Modify: `tests/common-model.test.mjs` — extend its VM DOM/storage fixture and exercise the actual toggle behavior.

**Interfaces:**
- `web/theme.ts` exports `type Theme = "dark" | "light"`, `THEME_STORAGE_KEY = "factoryos-theme"`, `readTheme(storage: Pick<Storage, "getItem">): Theme`, and `toggleTheme(theme: Theme): Theme`.
- `readTheme` returns `light` only for the stored string `light`; missing, invalid, or inaccessible storage returns `dark`.
- `toggleTheme` maps `dark` to `light` and `light` to `dark`.
- The app sets `document.documentElement.dataset.theme`, persists changes under `THEME_STORAGE_KEY`, and updates the button's icon, `aria-label`, and `title` after each toggle.

- [x] **Step 1: Add failing helper tests** in `tests/theme.test.mjs` for dark default, valid saved light/dark values, invalid value, storage exception, and both toggle directions.
- [x] **Step 2: Run `npm test`** and confirm the new tests fail because `web/theme.ts` does not exist.
- [x] **Step 3: Implement the typed helpers** in `web/theme.ts` using the exact exports above; catch storage read errors and return dark.
- [x] **Step 4: Run the focused helper tests** with `node --import tsx --test tests/theme.test.mjs` and confirm they pass.
- [x] **Step 5: Add failing wiring tests** in `tests/theme-wiring.test.mjs` for initial application of the saved theme, persistence on click, accessible dynamic sun/moon control, and dark/light CSS token declarations; add a toggle behavior test in `tests/common-model.test.mjs` using the existing app VM harness.
- [x] **Step 6: Run the focused wiring test** with `node --import tsx --test tests/theme-wiring.test.mjs` and confirm it fails before the UI/CSS changes.
- [x] **Step 7: Wire the app** in `web/main.ts`: read the initial value safely, apply it to the root element, render a real button immediately before the “LOCAL / WINDOWS” badge with inline SVG sun/moon icons, and update theme, storage, icon, and accessible text on click.
- [x] **Step 8: Add CSS theme tokens** in `web/style.css`: preserve the current dark palette values under `:root`/`[data-theme="dark"]`, add a readable light palette under `[data-theme="light"]`, and replace hard-coded UI colors with semantic tokens without changing layout.
- [x] **Step 9: Run `npm test` and `npm run build`**; both must pass.
- [x] **Step 10: Verify in the app/browser** that dark is shown on first visit, the button switches both ways, the chosen theme survives reload, keyboard focus is visible, and the light palette keeps text and controls legible.
