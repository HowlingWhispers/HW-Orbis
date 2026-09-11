import { describe, expect, it } from 'vitest';
import { buildTransferArchive, parseTransferArchive } from '../server/archive-transfer.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: 'character',
  name: 'Ragna Holt',
  summary: 'A test record',
  origin_world_id: null,
  source_type: 'user-created',
  source_asset_id: null,
  content_rating: 'sfw',
  tags: ['Bitterroot'],
  dependency_count: 0,
  pinned: false,
  visual_tone: 'forest',
  document: { sourceId: 'ragna-holt', notes: 'Safe archive test' },
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-10T00:00:00.000Z',
  speculus_prefix: 'C',
  speculus_ordinal: 1,
  speculus_generation: 1,
  speculus_series: 'XY',
  speculus_number: 12345,
  speculus_plate: 'XY12345',
  speculus_code: 'SPC-C-XY12345',
  speculus_classification: 'CHARACTER',
  speculus_status: 'active',
  speculus_assigned_at: '2026-09-01T00:00:00.000Z',
  speculus_retired_at: null,
  speculus_registry_number: 1,
  speculus_asset_created_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('Orbis transfer archives', () => {
  it('round-trips a checksummed SPC record with its permanent identity', () => {
    const archive = buildTransferArchive(
      { kind: 'record', rootAssetId: '11111111-1111-4111-8111-111111111111' },
      [row()],
      new Date('2026-09-11T12:00:00.000Z'),
    );

    const parsed = parseTransferArchive(JSON.stringify(archive));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].speculus.code).toBe('SPC-C-XY12345');
    expect(parsed.records[0].document).toEqual({ sourceId: 'ragna-holt', notes: 'Safe archive test' });
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an archive changed after download', () => {
    const archive = buildTransferArchive(
      { kind: 'account' },
      [row()],
      new Date('2026-09-11T12:00:00.000Z'),
    );
    archive.records[0].name = 'Altered';
    expect(() => parseTransferArchive(JSON.stringify(archive))).toThrow('checksum');
  });

  it('rejects duplicate record IDs', () => {
    expect(() => buildTransferArchive(
      { kind: 'account' },
      [row(), row({ speculus_code: 'SPC-C-ZZ99999', speculus_plate: 'ZZ99999', speculus_number: 99999, speculus_registry_number: 2, speculus_ordinal: 2 })],
    )).toThrow('duplicate record IDs');
  });

  it('rejects a child whose included origin is not a world', () => {
    const origin = row();
    const child = row({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Child',
      origin_world_id: origin.id,
      speculus_code: 'SPC-P-ZZ99999',
      speculus_prefix: 'P',
      speculus_plate: 'ZZ99999',
      speculus_number: 99999,
      speculus_registry_number: 2,
      speculus_ordinal: 1,
    });
    const archive = buildTransferArchive({ kind: 'account' }, [origin, child]);
    expect(() => parseTransferArchive(JSON.stringify(archive))).toThrow('not a world');
  });
});
