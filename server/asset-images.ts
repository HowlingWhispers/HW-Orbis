import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from './config.js';

/**
 * Local Orbis artwork is a hard-capped, non-scalable asset type. One megabyte
 * per image is a product decision, not a transport limit: it keeps a large
 * gallery on a record cheap to back up and cheap to serve, and it is enforced
 * here so no other entry point (editor, Coda, import) can exceed it.
 */
export const MAX_LOCAL_IMAGE_BYTES = 1024 * 1024;

export const imageKinds = ['cover', 'gallery'] as const;
export type ImageKind = (typeof imageKinds)[number];

export const storageKinds = ['local', 'external'] as const;
export type StorageKind = (typeof storageKinds)[number];

const JPEG_START_OF_IMAGE = [0xff, 0xd8];

export interface InspectedImage {
  mimeType: string;
  extension: string;
  width: number | null;
  height: number | null;
}

export class AssetImageError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AssetImageError';
  }
}

const startsWith = (buffer: Buffer, signature: number[], offset = 0) =>
  signature.every((byte, index) => buffer[offset + index] === byte);

const asciiAt = (buffer: Buffer, offset: number, length: number) =>
  buffer.subarray(offset, offset + length).toString('latin1');

function pngSize(buffer: Buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifSize(buffer: Buffer) {
  if (buffer.length < 10) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function jpegSize(buffer: Buffer) {
  // Walk the segment chain until a start-of-frame marker carries the dimensions.
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > buffer.length) return null;
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function webpSize(buffer: Buffer) {
  if (buffer.length < 30) return null;
  const chunk = asciiAt(buffer, 12, 4);
  if (chunk === 'VP8 ') {
    if (!startsWith(buffer, [0x9d, 0x01, 0x2a], 23)) return null;
    return { width: (buffer.readUInt16LE(26) ?? 0) & 0x3fff, height: (buffer.readUInt16LE(28) ?? 0) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return {
      width: ((buffer[23] ?? 0) | ((buffer[24] ?? 0) << 8) | ((buffer[25] ?? 0) << 16)) + 1,
      height: ((buffer[26] ?? 0) | ((buffer[27] ?? 0) << 8) | ((buffer[28] ?? 0) << 16)) + 1,
    };
  }
  return null;
}

/**
 * Identify the format from the bytes themselves. A client-supplied
 * `Content-Type` or filename is attacker-controlled and is never trusted to
 * decide what Orbis writes to disk or later serves back.
 */
export function inspectImageBytes(bytes: Buffer): InspectedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', extension: 'png', ...(pngSize(bytes) ?? { width: null, height: null }) };
  }
  if (startsWith(bytes, JPEG_START_OF_IMAGE)) {
    return { mimeType: 'image/jpeg', extension: 'jpg', ...(jpegSize(bytes) ?? { width: null, height: null }) };
  }
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp', ...(webpSize(bytes) ?? { width: null, height: null }) };
  }
  // A real GIF declares GIF87a or GIF89a. Matching only "GIF" would accept any
  // file that happens to start with those three letters.
  if (asciiAt(bytes, 0, 6) === 'GIF87a' || asciiAt(bytes, 0, 6) === 'GIF89a') {
    return { mimeType: 'image/gif', extension: 'gif', ...(gifSize(bytes) ?? { width: null, height: null }) };
  }
  return null;
}

export function assertSupportedImageSize(byteLength: number) {
  if (byteLength <= 0) throw new AssetImageError(400, 'That file was empty. Choose an image and try again.');
  if (byteLength > MAX_LOCAL_IMAGE_BYTES) {
    throw new AssetImageError(413, `Orbis stores images up to ${Math.floor(MAX_LOCAL_IMAGE_BYTES / 1024)} KB each. That file is ${Math.round(byteLength / 1024)} KB.`);
  }
}

export function assertSupportedImageFormat(bytes: Buffer) {
  const inspected = inspectImageBytes(bytes);
  if (!inspected) {
    throw new AssetImageError(415, 'Orbis accepts JPEG, PNG, WebP and GIF images only.');
  }
  return inspected;
}

export const imageMetadataSchema = z.object({
  kind: z.enum(imageKinds).default('gallery'),
  caption: z.string().trim().max(300).optional(),
  altText: z.string().trim().max(300).optional(),
  focalX: z.coerce.number().min(0).max(1).default(0.5),
  focalY: z.coerce.number().min(0).max(1).default(0.5),
  fileName: z.string().trim().max(200).optional(),
});

export const externalImageSchema = z.object({
  storageKind: z.literal('external'),
  url: z.string().trim().max(2000).url().refine((value) => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }, 'External image URLs must use HTTPS.'),
  kind: z.enum(imageKinds).default('gallery'),
  caption: z.string().trim().max(300).optional(),
  altText: z.string().trim().max(300).optional(),
  focalX: z.coerce.number().min(0).max(1).default(0.5),
  focalY: z.coerce.number().min(0).max(1).default(0.5),
});

export const imageUpdateSchema = z.object({
  caption: z.string().trim().max(300).nullable().optional(),
  altText: z.string().trim().max(300).nullable().optional(),
  focalX: z.coerce.number().min(0).max(1).optional(),
  focalY: z.coerce.number().min(0).max(1).optional(),
  position: z.coerce.number().int().min(0).max(10_000).optional(),
  kind: z.enum(imageKinds).optional(),
});

export type ImageMetadataInput = z.infer<typeof imageMetadataSchema>;
export type ExternalImageInput = z.infer<typeof externalImageSchema>;
export type ImageUpdateInput = z.infer<typeof imageUpdateSchema>;

/** Cover artwork is cropped responsively at 16:9, so the preferred sources are 16:9. */
export const PREFERRED_COVER_WIDTHS = [1600, 1280] as const;
export const COVER_ASPECT_RATIO = 16 / 9;

export function isPreferredCoverSize(width: number | null, height: number | null) {
  if (!width || !height) return false;
  return PREFERRED_COVER_WIDTHS.includes(width as 1600 | 1280) || Math.abs(width / height - COVER_ASPECT_RATIO) <= 0.02;
}

export function assetImageMediaRoot(config: AppConfig) {
  return path.resolve(config.ORBIS_MEDIA_ROOT);
}

/**
 * Resolve a stored relative path to an absolute one, refusing anything that
 * escapes the media root. The stored value is written only by Orbis, but a
 * traversal guard here means a tampered row can never read outside the root.
 */
export function resolveStoredImagePath(config: AppConfig, storagePath: string) {
  const root = assetImageMediaRoot(config);
  const absolute = path.resolve(root, storagePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new AssetImageError(400, 'That stored image path is not inside the Orbis media root.');
  }
  return absolute;
}

export function buildStoredImagePath(assetId: string, imageId: string, extension: string) {
  return path.posix.join(assetId, `${imageId}.${extension}`);
}

/** Write image bytes to disk and return the relative path plus detected metadata. */
export async function storeLocalImage(config: AppConfig, assetId: string, bytes: Buffer) {
  assertSupportedImageSize(bytes.length);
  const inspected = assertSupportedImageFormat(bytes);
  const imageId = randomUUID();
  const storagePath = buildStoredImagePath(assetId, imageId, inspected.extension);
  const absolute = resolveStoredImagePath(config, storagePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  // Write to a private temporary name and rename into place so a partially
  // written file is never reachable through the media route.
  const staging = `${absolute}.${createHash('sha256').update(storagePath).digest('hex').slice(0, 8)}.part`;
  await writeFile(staging, bytes, { mode: 0o640 });
  await rename(staging, absolute);
  return {
    imageId,
    storagePath,
    mimeType: inspected.mimeType,
    width: inspected.width,
    height: inspected.height,
    byteSize: bytes.length,
  };
}

/** Remove a stored local file. Missing files are treated as already gone. */
export async function removeLocalImage(config: AppConfig, storagePath: string) {
  await rm(resolveStoredImagePath(config, storagePath), { force: true });
}
