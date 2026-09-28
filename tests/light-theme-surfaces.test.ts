import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const theme = readFileSync(join(import.meta.dirname, '../src/styles/theme.css'), 'utf8');

/**
 * A tab strip authored with dark values shows up in light mode as a dark band
 * directly under the identity header, which is the most visible version of this
 * bug. CSS has no way to fail loudly here, so these assert that each strip has
 * a light counterpart rather than trusting that one was added.
 */
const stripsNeedingLightPass = [
  '.account-tab',
  '.coda-subtabs button',
  '.admin-tabs',
];

const panelsNeedingLightPass = [
  '.admin-section',
  '.status-card',
  '.capability-card',
  '.audit-list > div',
  '.coda-status-grid article',
  '.coda-template-list article',
  '.coda-console__preview',
  '.coda-shared-use__list li',
];

const lightRulesFor = (selector: string) =>
  theme
    .split('}')
    .filter((block) => block.includes(`[data-theme='light']`) && block.includes(selector))
    .map((block) => block.slice(block.lastIndexOf(';', block.indexOf('{') - 1) + 1));

describe('light mode surface coverage', () => {
  it.each(stripsNeedingLightPass)('gives %s a light background, not a dark one', (selector) => {
    const rules = lightRulesFor(selector);
    expect(rules.length).toBeGreaterThan(0);
    // Positive check: a light pass has to set a genuinely light colour. Asserting
    // the absence of dark values would wrongly fail on a warm hover tint.
    const luminances = [...rules.join(' ').matchAll(/background:[^;]*rgba\(\s*(\d+),\s*(\d+),\s*(\d+)/g)]
      .map(([, r, g, b]) => Number(r) + Number(g) + Number(b));
    expect(luminances.length).toBeGreaterThan(0);
    expect(Math.max(...luminances)).toBeGreaterThan(600);
  });

  it.each(panelsNeedingLightPass)('gives %s an explicit light background', (selector) => {
    expect(lightRulesFor(selector).join(' ')).toMatch(/background:/);
  });

  it('keeps the active tab legible on a light surface', () => {
    expect(theme).toMatch(/\[data-theme='light'\] \.account-tab\.is-active/);
  });
});
