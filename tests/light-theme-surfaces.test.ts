import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(join(import.meta.dirname, '..', relative), 'utf8');

const theme = read('src/styles/theme.css');
const main = read('src/main.tsx');

/** Custom properties as the light theme defines them, so var() can be resolved. */
const lightTokens = new Map<string, string>();
for (const [, body] of theme.matchAll(/:root\[data-theme='light'\]\s*\{([^}]*)\}/g)) {
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    lightTokens.set(name, value.trim());
  }
}

/** Every light-mode rule, with its selector list parsed rather than substring-matched.
 *  Comments are stripped first: a block comment sitting above a rule is otherwise
 *  captured as part of that rule's selector and no selector ever matches. */
const css = theme.replace(/\/\*[\s\S]*?\*\//g, '');
const lightRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel]) => sel.includes("[data-theme='light']"))
  .map(([, sel, body]) => ({
    selectors: new Set(
      sel
        .replace(/:root\[data-theme='light'\]\s*/g, '')
        .split(',')
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
    body,
  }));

const norm = (selector: string) => selector.trim().replace(/\s+/g, ' ');

/** Resolves a CSS colour value to r+g+b sums, substituting light var() first. */
const luminanceOf = (raw: string) => {
  const value = raw
    .replace(/var\((--[\w-]+)\)/g, (_, name: string) => lightTokens.get(name) ?? '')
    .replace(/#[0-9a-f]{3,8}/gi, (hex) => {
      const digits = hex.slice(1);
      const full = digits.length <= 4 ? [...digits].map((c) => c + c).join('') : digits.slice(0, 6);
      return `rgb(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)})`;
    });
  return [...value.matchAll(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/g)]
    .map(([, r, g, b]) => Number(r) + Number(g) + Number(b));
};

const luminancesIn = (body: string) =>
  [...body.matchAll(/(?<!-)background(?:-color)?\s*:\s*([^;}]+)/g)]
    .flatMap(([, raw]) => luminanceOf(raw));

const brightestLightBackground = (selector: string) => {
  const rules = lightRules.filter((rule) => rule.selectors.has(norm(selector)));
  return Math.max(...rules.flatMap((rule) => luminancesIn(rule.body)), -Infinity);
};

const tabStrips = ['.account-tab', '.coda-subtabs button', '.admin-tabs'];
const panels = [
  '.admin-section', '.status-card', '.capability-card', '.audit-list > div',
  '.coda-status-grid article', '.coda-template-list article', '.coda-console__preview',
  '.coda-shared-use__list li', '.coda-launcher', '.coda-assistant', '.coda-file-assistant',
  '.coda-workspace-hero', '.coda-workspace-panel', '.coda-proposal', '.coda-world-search',
  '.coda-workbench-composer', '.project-hero', '.project-eta', '.project-phase',
  '.project-later', '.project-release-panel', '.project-feature-grid > div',
  '.project-update-columns > div', '.project-countdown__unit', '.project-development-update',
  '.document-content > .document-section', '.document-record-card', '.document-list li',
  '.world-json-import', '.collection-header', '.collection-search', '.select-control',
  '.quiet-note', '.verification-steps > div', '.structured-group', '.structured-repeater__item',
  '.document-cards > .document-content', '.admin-header', '.editor-header', '.icon-button',
];
const warnings = ['.world-delete-review'];
const codeBlocks = [
  '.coda-field-preview pre', '.coda-workspace-patch pre', '.coda-workspace-proposal pre',
  '.world-delete-review__backup', '.asset-images__gallery li',
];

describe('light mode surface coverage', () => {
  it.each([...tabStrips, ...panels])('gives %s a light background', (selector) => {
    // Positive check: the override must set a genuinely light colour. Asserting
    // the absence of dark values would wrongly fail on a warm hover tint.
    expect(brightestLightBackground(selector)).toBeGreaterThan(600);
  });

  it.each(warnings)('lightens %s while keeping its warning identity', (selector) => {
    // A destructive panel keeps its red, so it is never as light as a plain
    // surface, but it must be off the near-black the dark theme uses.
    const brightness = brightestLightBackground(selector);
    expect(brightness).toBeGreaterThan(150);
    expect(lightRules.some((rule) => rule.selectors.has(norm(selector)))).toBe(true);
  });

  it.each(codeBlocks)('lightens %s without leaving it near-black', (selector) => {
    // Distinct from its surroundings, so code stays legible as code, but well
    // clear of the near-black these use in the dark theme.
    const brightest = brightestLightBackground(selector);
    expect(brightest).toBeGreaterThan(300);
    expect(brightest).toBeLessThan(700);
  });

  it('keeps the active tab legible on a light surface', () => {
    expect(theme).toMatch(/\[data-theme='light'\] \.account-tab\.is-active/);
  });

  it('leaves the deliberate dark overlays dark', () => {
    // These dim the page or sit on artwork, and are intentionally not part of
    // the light pass. Asserted so a future sweep does not "fix" them.
    for (const overlay of ['.whats-new-backdrop', '.sidebar-backdrop', '.asset-card__scrim']) {
      expect(theme).not.toContain(`[data-theme='light'] ${overlay}`);
    }
  });
});

describe('stylesheet order', () => {
  it('imports the light-mode overrides last', () => {
    const sheets = [...main.matchAll(/import '\.\/styles\/([^']+)\.css'/g)].map((m) => m[1]);
    expect(sheets.length).toBeGreaterThan(1);
    // Equal specificity is settled by order, so the overrides must come after
    // the sheets that define rules such as `.coda-assistant textarea`.
    expect(sheets[sheets.length - 1]).toBe('theme');
  });
});
