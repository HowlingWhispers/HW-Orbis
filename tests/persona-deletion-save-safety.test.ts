import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const migrations = readdirSync(join(repoRoot, 'server/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(repoRoot, 'server/migrations', name), 'utf8') }));
const saveArchive = readFileSync(join(repoRoot, 'server/save-archive.ts'), 'utf8');

const savesTable = migrations
  .map((m) => m.sql.match(/CREATE TABLE IF NOT EXISTS speculus_saves \(([\s\S]*?)\n\);/)?.[1])
  .find(Boolean) ?? '';

/**
 * Deleting a Persona is a delete of a record that simulations were launched
 * from, so the question worth pinning down is what it does to saves. Two
 * distinct outcomes, and they are easy to conflate:
 *
 *  - a save that already exists keeps working, because the Persona travels
 *    inside the save payload as a snapshot rather than as a reference
 *  - re-importing an exported session that was launched from that Persona is
 *    refused, because the import re-resolves its source record
 */
describe('Persona deletion and save safety', () => {
  it('stores the save Persona as a payload snapshot, not as a reference', () => {
    // No persona column exists on the table at all.
    expect(savesTable).not.toMatch(/persona_id/i);
    // And the source is a bare uuid with no referential integrity, so deleting
    // the source asset cannot cascade a save away.
    const sourceLine = savesTable.split('\n').find((l) => l.includes('source_asset_id')) ?? '';
    expect(sourceLine).toMatch(/source_asset_id uuid NOT NULL/);
    expect(sourceLine).not.toMatch(/REFERENCES/i);
  });

  it('never cascades a save when its world-linked record is deleted', () => {
    // world_id is the only foreign key a save holds, and it nulls rather than
    // cascades, so even the worst case keeps the row.
    const worldLine = savesTable.split('\n').find((l) => l.includes('world_id')) ?? '';
    expect(worldLine).toMatch(/REFERENCES library_assets\(id\) ON DELETE SET NULL/);
    expect(savesTable).not.toMatch(/REFERENCES library_assets\(id\) ON DELETE CASCADE/);
  });

  it('declares no persona foreign key anywhere in the schema', () => {
    const personaForeignKey = migrations.filter((m) =>
      /persona[^\n]*REFERENCES|REFERENCES[^\n]*persona/i.test(m.sql));
    expect(personaForeignKey.map((m) => m.name)).toEqual([]);
  });

  it('keeps the persona optional in the validated save payload', () => {
    // Optional, and a snapshot of id and name rather than anything resolved
    // from the library, so nothing here needs the asset row to still exist.
    expect(saveArchive).toMatch(/persona: z\.object\(\{ id: z\.string\(\)\.min\(1\)\.max\(200\), name: z\.string\(\)\.min\(1\)\.max\(200\) \}\)\.optional\(\)/);
  });

  it('refuses to re-import an exported session whose source record is gone', () => {
    // This is the real user-visible consequence, and it is a refusal rather
    // than a silent breakage: the import re-resolves source.id.
    expect(saveArchive).toMatch(/WHERE id = \$1', \[save\.source\.id\]/);
    expect(saveArchive).toMatch(/The save source record no longer exists in Orbis/);
  });

  it('still titles a save from the embedded persona name', () => {
    // Proof that the stored Persona name is read from the payload, not looked
    // up, so a deleted Persona does not blank an existing save's title.
    expect(saveArchive).toMatch(/save\.source\.persona\?\.name/);
  });
});
