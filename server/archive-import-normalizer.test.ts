import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseTransferArchiveForImport } from './archive-import-normalizer.js';

const checksum = (body: Record<string, unknown>) => createHash('sha256').update(JSON.stringify(body)).digest('hex');

function legacyArchive() {
  const body = {
    format: 'orbis-transfer' as const,
    version: 1 as const,
    exportedAt: '2026-09-26T18:00:09.789Z',
    scope: { kind: 'world' as const, rootAssetId: '971b3fc6-c6d7-4007-a3ea-0bc92272d74b' },
    records: [{
      id: '971b3fc6-c6d7-4007-a3ea-0bc92272d74b',
      type: 'world' as const,
      name: 'Everglow',
      summary: 'x'.repeat(2200),
      originWorldId: null,
      sourceType: 'user-created' as const,
      sourceAssetId: null,
      contentRating: 'sfw' as const,
      tags: [],
      dependencyCount: 0,
      pinned: false,
      visualTone: '',
      document: { identity: { name: 'Everglow' } },
      createdAt: '2026-09-26T16:23:53.475Z',
      updatedAt: '2026-09-26T18:00:09.789Z',
      speculus: {
        prefix: '', ordinal: null, generation: null, series: '', number: null, plate: '',
        code: '', classification: '', status: '', assignedAt: '', retiredAt: null,
        registryNumber: null, assetCreatedAt: '',
      },
    }],
  };
  return JSON.stringify({ ...body, sha256: checksum(body) });
}

describe('legacy Orbis transfer import normalization', () => {
  it('accepts checksum-valid archives with pre-SPC compatibility metadata', () => {
    const result = parseTransferArchiveForImport(legacyArchive());
    expect(result.archive.records).toHaveLength(1);
    expect(result.archive.records[0]?.visualTone).toBe('moon');
    expect(result.archive.records[0]?.summary).toHaveLength(2000);
    expect(result.archive.records[0]?.speculus).toBeNull();
    expect(result.repairs).toEqual({
      defaultedVisualTones: 1,
      truncatedSummaries: 1,
      regeneratedSpeculus: 1,
    });
  });

  it('still refuses a damaged archive', () => {
    const parsed = JSON.parse(legacyArchive()) as Record<string, unknown>;
    parsed.sha256 = '0'.repeat(64);
    expect(() => parseTransferArchiveForImport(JSON.stringify(parsed))).toThrow('checksum does not match');
  });
});
