import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AssetImageError, assertSupportedImageFormat, assertSupportedImageSize, buildStoredImagePath, inspectImageBytes,
  isPreferredCoverSize, MAX_LOCAL_IMAGE_BYTES, removeLocalImage, resolveStoredImagePath, storeLocalImage,
} from '../server/asset-images';
import { loadConfig } from '../server/config';
import { mapAssetImage, mediaUrlForImage } from '../server/media';

const assetId = '27d31940-108b-4dde-975d-bd8c1a327f83';

const baseEnv = {
  NODE_ENV: 'test', PORT: '8789', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'asset-image-test-secret-long-enough-value', SESSION_COOKIE_NAME: 'orbis.sid', TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: '1544909655275208716', DISCORD_ADULT_ROLE_IDS: '', DISCORD_CREATOR_ROLE_IDS: '',
  DISCORD_ADMIN_ROLE_IDS: '', DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '', DISCORD_INVITE_URL: '', VITE_DISCORD_INVITE_URL: '',
  ORBIS_VERSION: 'test', ORBIS_BUILD_SHA: 'test',
} as const;

const mediaConfigFor = (mediaRoot: string) => loadConfig({ ...baseEnv, ORBIS_MEDIA_ROOT: mediaRoot });

/** Minimal but structurally valid PNG header: signature, IHDR, then 64x64 pixels. */
function pngBytes(width = 64, height = 64) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(13, 16);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; bytes[25] = 6;
  return bytes;
}

function gifBytes(width = 48, height = 24) {
  const bytes = Buffer.alloc(13);
  bytes.write('GIF89a', 0, 'latin1');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function jpegBytes(width = 300, height = 150) {
  const bytes = Buffer.alloc(30);
  bytes[0] = 0xff; bytes[1] = 0xd8;
  bytes[2] = 0xff; bytes[3] = 0xc0;         // SOF0
  bytes.writeUInt16BE(17, 4);                // segment length
  bytes[6] = 8;                              // sample precision
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function webpLossyBytes(width = 1600, height = 900) {
  const bytes = Buffer.alloc(32);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(20, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write('VP8 ', 12, 'latin1');
  bytes.writeUInt32LE(10, 16);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(bytes, 23);
  bytes.writeUInt16LE(width, 26);
  bytes.writeUInt16LE(height, 28);
  return bytes;
}

describe('Orbis image format detection', () => {
  it('identifies supported formats from their bytes and reads their dimensions', () => {
    expect(inspectImageBytes(pngBytes(1600, 900))).toMatchObject({ mimeType: 'image/png', extension: 'png', width: 1600, height: 900 });
    expect(inspectImageBytes(gifBytes(48, 24))).toMatchObject({ mimeType: 'image/gif', extension: 'gif', width: 48, height: 24 });
    expect(inspectImageBytes(jpegBytes(300, 150))).toMatchObject({ mimeType: 'image/jpeg', extension: 'jpg', width: 300, height: 150 });
    expect(inspectImageBytes(webpLossyBytes(1280, 720))).toMatchObject({ mimeType: 'image/webp', extension: 'webp', width: 1280, height: 720 });
  });

  it('refuses anything that is not a supported image, whatever the client claims', () => {
    // A request that lies with its Content-Type or filename still stores nothing.
    expect(() => assertSupportedImageFormat(Buffer.from('<svg onload="alert(1)"></svg>'))).toThrow(AssetImageError);
    expect(() => assertSupportedImageFormat(Buffer.from('%PDF-1.7'))).toThrow(/JPEG, PNG, WebP and GIF/);
  });

  it('hard-caps local images at 1 MB', () => {
    expect(MAX_LOCAL_IMAGE_BYTES).toBe(1024 * 1024);
    expect(() => assertSupportedImageSize(MAX_LOCAL_IMAGE_BYTES)).not.toThrow();
    expect(() => assertSupportedImageSize(MAX_LOCAL_IMAGE_BYTES + 1)).toThrow(AssetImageError);
    expect(() => assertSupportedImageSize(0)).toThrow(/empty/);
  });
});

describe('Orbis local image storage', () => {
  let root: string;
  let mediaConfig: ReturnType<typeof mediaConfigFor>;

  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'orbis-media-')); mediaConfig = mediaConfigFor(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('writes bytes to disk under the asset directory and returns only a relative path', async () => {
    const stored = await storeLocalImage(mediaConfig, assetId, pngBytes(1600, 900));
    expect(stored.storagePath.startsWith(`${assetId}/`)).toBe(true);
    expect(path.isAbsolute(stored.storagePath)).toBe(false);
    expect(stored.storagePath.endsWith('.png')).toBe(true);
    expect(stored.mimeType).toBe('image/png');
    expect(stored.byteSize).toBe(33);

    const written = await readFile(resolveStoredImagePath(mediaConfig, stored.storagePath));
    expect(written.equals(pngBytes(1600, 900))).toBe(true);
  });

  it('leaves no partial staging file behind after a successful write', async () => {
    const stored = await storeLocalImage(mediaConfig, assetId, pngBytes());
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(path.join(root, assetId));
    expect(entries.filter((name) => name.endsWith('.part'))).toEqual([]);
    expect(entries).toEqual([path.basename(stored.storagePath)]);
  });

  it('removes a stored image and tolerates one that is already gone', async () => {
    const stored = await storeLocalImage(mediaConfig, assetId, pngBytes());
    await removeLocalImage(mediaConfig, stored.storagePath);
    await expect(readFile(resolveStoredImagePath(mediaConfig, stored.storagePath))).rejects.toThrow();
    await expect(removeLocalImage(mediaConfig, stored.storagePath)).resolves.toBeUndefined();
  });

  it('refuses a stored path that would escape the media root', async () => {
    expect(() => resolveStoredImagePath(mediaConfig, '../../../etc/passwd')).toThrow(AssetImageError);
    expect(() => resolveStoredImagePath(mediaConfig, '/etc/passwd')).toThrow(AssetImageError);
  });

  it('never stores a file for an oversized upload', async () => {
    const oversized = Buffer.concat([pngBytes(), Buffer.alloc(MAX_LOCAL_IMAGE_BYTES)]);
    await expect(storeLocalImage(mediaConfig, assetId, oversized)).rejects.toThrow(AssetImageError);
    const { readdir } = await import('node:fs/promises');
    await expect(readdir(path.join(root, assetId))).rejects.toThrow();
  });

  it('keeps the default media root outside the repository', () => {
    const defaults = loadConfig({ ...baseEnv, ORBIS_MEDIA_ROOT: undefined } as unknown as NodeJS.ProcessEnv);
    expect(defaults.ORBIS_MEDIA_ROOT).toBe('/srv/howling-whispers/orbis-media');
    expect(buildStoredImagePath(assetId, 'image-id', 'jpg')).toBe(`${assetId}/image-id.jpg`);
  });
});

describe('16:9 cover artwork guidance', () => {
  it('recognises the preferred cover sizes', () => {
    expect(isPreferredCoverSize(1600, 900)).toBe(true);
    expect(isPreferredCoverSize(1280, 720)).toBe(true);
    expect(isPreferredCoverSize(300, 150)).toBe(false);
    expect(isPreferredCoverSize(null, null)).toBe(false);
  });
});

describe('image records exposed to the browser', () => {
  const row = {
    id: '5d1f2a10-0000-4000-8000-000000000001', asset_id: assetId, kind: 'cover', storage_kind: 'local',
    storage_path: `${assetId}/5d1f2a10-0000-4000-8000-000000000001.png`, external_url: null, file_name: 'cover.png',
    mime_type: 'image/png', byte_size: 2048, width: 1600, height: 900, caption: 'The ridge at dusk', alt_text: 'A rocky ridge at dusk',
    focal_x: 0.4, focal_y: 0.3, position: 0, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  it('serves local artwork through the access-checked Orbis media route, not a public path', () => {
    const mapped = mapAssetImage(row);
    expect(mapped.url).toBe(mediaUrlForImage(String(row.id)));
    expect(mapped.url).toBe(`/v1/library/media/${row.id}`);
    expect(mapped.url).not.toContain('storage_path');
  });

  it('carries the focal point and descriptive text through to the client', () => {
    const mapped = mapAssetImage(row);
    expect(mapped).toMatchObject({ kind: 'cover', storageKind: 'local', focalX: 0.4, focalY: 0.3, width: 1600, height: 900, caption: 'The ridge at dusk', altText: 'A rocky ridge at dusk' });
  });

  it('uses the external URL verbatim for linked artwork', () => {
    const mapped = mapAssetImage({ ...row, storage_kind: 'external', storage_path: null, external_url: 'https://example.com/art.png' });
    expect(mapped.url).toBe('https://example.com/art.png');
  });
});

describe('unsupported media type is refused before anything is written', () => {
  it('rejects a request body that is not a supported image', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orbis-media-refuse-'));
    try {
      // A filename or Content-Type claiming to be an image is not enough; the bytes decide.
      await expect(storeLocalImage(mediaConfigFor(root), assetId, Buffer.from('<html><script>alert(1)</script></html>'))).rejects.toThrow(/JPEG, PNG, WebP and GIF/);
      const { readdir } = await import('node:fs/promises');
      await expect(readdir(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
