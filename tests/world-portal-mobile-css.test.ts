// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const portalCss = readFileSync(new URL('../src/styles/world-portal.css', import.meta.url), 'utf8');

describe('world portal mobile width containment', () => {
  it('allows the detail grid and both panels to shrink below desktop min-content width', () => {
    expect(globalCss).toContain('grid-template-columns: minmax(0, 1fr) minmax(280px, 330px)');
    expect(globalCss).toContain('.detail-layout > *, .record-panel, .metadata-panel { min-width: 0; }');
    expect(globalCss).toContain('.detail-layout { grid-template-columns: minmax(0, 1fr); }');
  });

  it('contains horizontal tab scrolling and long prose inside the record panel', () => {
    expect(portalCss).toMatch(/\.world-tabs\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*auto/s);
    expect(portalCss).toMatch(/\.world-tabs\s*\{[^}]*margin-inline:\s*0/s);
    expect(portalCss).toMatch(/\.world-field p,[\s\S]*?overflow-wrap:\s*anywhere/);
  });
});
