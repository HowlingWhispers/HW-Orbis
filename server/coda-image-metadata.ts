/**
 * Image metadata extraction for generated pictures.
 *
 * Two hard rules govern this module.
 *
 * 1. Metadata is not perception. Anything this file returns came out of the
 *    file's own bytes, which means it describes an earlier tool's request. It
 *    says nothing about what is visibly in the picture. Callers must label it
 *    as metadata-derived, and must never let it stand in for having looked.
 *
 * 2. Nothing here trusts a filename or a MIME type. The generator chooses the
 *    response encoding, so the format is decided by sniffing magic bytes and a
 *    corrupt or truncated file is reported as such rather than parsed
 *    hopefully.
 *
 * This is the Orbis-side copy. HW-Coda has an equivalent module because it
 * inspects images Discord members upload. The two repositories do not share a
 * build, so the duplication is deliberate and each copy points at the other;
 * keep the two in step when changing the chunk grammar.
 */

import { inflateSync } from 'node:zlib';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface NovelAiGenerationInfo {
  /** Model string recorded by the generator, when it wrote one. */
  model?: string;
  steps?: number;
  scale?: number;
  seed?: number;
  sampler?: string;
  width?: number;
  height?: number;
  /** The positive prompt the generator received. */
  prompt?: string;
  /** Unconditional/negative prompt text, when recorded. */
  negativePrompt?: string;
  source?: string;
}

export interface PngMetadata {
  /** Every text chunk, keyed by its keyword, verbatim. */
  fields: Record<string, string>;
  software?: string;
  source?: string;
  comment?: string;
  /**
   * The generator's own JSON description, when the file carries one. Kept as
   * the raw string too, because the schema changes between generators.
   */
  description?: string;
  generation?: NovelAiGenerationInfo;
}

export interface ImageInspection {
  format: ImageFormat;
  width: number | null;
  height: number | null;
  byteLength: number;
  /** PNG tEXt/iTXt/zTXt metadata, when the file is a PNG that carries it. */
  png?: PngMetadata;
  /** True when the file claims a format but its bytes do not hold together. */
  corrupt: boolean;
  reason?: string;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

export function readImageDimensions(bytes: Uint8Array, format: ImageFormat): { width: number | null; height: number | null } {
  if (format === 'png') return readPngDimensions(bytes);
  if (format === 'jpeg') return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

function readPngDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 8 signature + 4 length + 4 "IHDR" then width/height as big-endian uint32.
  if (bytes.length < 24) return { width: null, height: null };
  if (view.getUint32(12) !== 0x49484452) return { width: null, height: null };
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    // SOF0..SOF15, skipping the non-frame markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return { width, height };
    }
    const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (segmentLength < 2) return { width: null, height: null };
    offset += 2 + segmentLength;
  }
  return { width: null, height: null };
}

function readWebpDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return { width: null, height: null };
}

function readNullTerminated(bytes: Uint8Array, start: number) {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { value: Buffer.from(bytes.subarray(start, end)).toString('latin1'), next: end + 1 };
}

function inflateSafely(bytes: Uint8Array): string | null {
  try {
    return inflateSync(Buffer.from(bytes)).toString('utf8');
  } catch {
    // A chunk that claims compression it does not have is a corrupt file, not
    // a reason to throw out of the middle of attachment handling.
    return null;
  }
}

/**
 * Read every tEXt, zTXt and iTXt chunk before the first IDAT chunk.
 *
 * Text chunks live before the image data by specification, so stopping at IDAT
 * bounds the work on a large image instead of walking the whole file.
 */
export function parsePngTextChunks(bytes: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!startsWith(bytes, PNG_SIGNATURE)) return fields;

  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > bytes.length || dataEnd > bytes.length) break;
    if (type === 'IDAT' || type === 'IEND') break;

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const keyword = readNullTerminated(bytes, dataStart);
      let text: string | null = null;
      if (type === 'tEXt') {
        text = Buffer.from(bytes.subarray(keyword.next, dataEnd)).toString('latin1');
      } else if (type === 'zTXt') {
        // zTXt is keyword \0 compressionMethod compressedText. There is no
        // compression flag byte here; method 0 is the only defined method and
        // means a zlib stream. An unknown method is read as raw text rather
        // than dropped, so a future compression method still yields something.
        const compressionMethod = bytes[keyword.next];
        text = compressionMethod === 0
          ? inflateSafely(bytes.subarray(keyword.next + 1, dataEnd))
          : Buffer.from(bytes.subarray(keyword.next + 1, dataEnd)).toString('latin1');
      } else {
        const compressionFlag = bytes[keyword.next];
        const method = bytes[keyword.next + 1];
        const language = readNullTerminated(bytes, keyword.next + 2);
        const translated = readNullTerminated(bytes, language.next);
        const payload = bytes.subarray(translated.next, dataEnd);
        text = compressionFlag === 1
          ? (method === 0 ? inflateSafely(payload) : null)
          : Buffer.from(payload).toString('utf8');
      }
      if (text !== null && keyword.value) fields[keyword.value] = text;
    }
    // Chunk layout: length(4) type(4) data(length) crc(4).
    offset = dataEnd + 4;
  }
  return fields;
}

function asNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asText(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').join(', ') || undefined;
  return undefined;
}

/**
 * NovelAI writes a JSON `Description` chunk holding the full generation request.
 * Fields differ between model generations, so everything is optional and the
 * raw string is preserved alongside whatever could be understood.
 */
export function describeNovelAiGeneration(fields: Record<string, string>): NovelAiGenerationInfo | undefined {
  const description = fields.Description ?? fields.description;
  if (!description) return undefined;
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(description) as unknown;
    if (!value || typeof value !== 'object') return { source: fields.Source };
    parsed = value as Record<string, unknown>;
  } catch {
    // Some generators write a prose description instead of JSON. That is still
    // metadata; it is simply not structured, so nothing is extracted.
    return { source: fields.Source };
  }

  const parameters = (parsed.parameters && typeof parsed.parameters === 'object'
    ? parsed.parameters as Record<string, unknown>
    : parsed);
  const info: NovelAiGenerationInfo = { source: fields.Source ?? asText(parsed.model) };
  const assign = <T extends keyof NovelAiGenerationInfo>(key: T, value: NovelAiGenerationInfo[T]) => {
    if (value !== undefined) info[key] = value;
  };
  assign('model', asText(parsed.model) ?? asText(parameters.model));
  assign('steps', asNumber(parameters.steps));
  assign('scale', asNumber(parameters.scale));
  assign('seed', asNumber(parameters.seed));
  assign('sampler', asText(parameters.sampler));
  assign('width', asNumber(parameters.width));
  assign('height', asNumber(parameters.height));
  assign('prompt', asText(parsed.input) ?? asText(parsed.prompt));
  assign('negativePrompt', asText(parameters.uc) ?? asText(parameters.negative_prompt));
  return info;
}

export function parsePngMetadata(bytes: Uint8Array): PngMetadata | undefined {
  const fields = parsePngTextChunks(bytes);
  if (!Object.keys(fields).length) return undefined;
  const metadata: PngMetadata = { fields };
  if (fields.Software) metadata.software = fields.Software;
  if (fields.Source) metadata.source = fields.Source;
  if (fields.Comment) metadata.comment = fields.Comment;
  if (fields.Description) metadata.description = fields.Description;
  const generation = describeNovelAiGeneration(fields);
  if (generation && Object.keys(generation).length) metadata.generation = generation;
  return metadata;
}

/**
 * Full inspection of an attachment body.
 *
 * The `corrupt` flag means the bytes contradict the format they claim, which is
 * reported honestly instead of being silently parsed as whatever happened to be
 * readable.
 */
export function inspectImage(bytes: Uint8Array): ImageInspection | null {
  const format = sniffImageFormat(bytes);
  if (!format) return null;
  const { width, height } = readImageDimensions(bytes, format);
  if (width === null || height === null || width <= 0 || height <= 0) {
    return {
      format,
      width: null,
      height: null,
      byteLength: bytes.byteLength,
      corrupt: true,
      reason: `The file claims to be ${format.toUpperCase()} but its header is truncated or damaged.`,
    };
  }
  const inspection: ImageInspection = {
    format,
    width,
    height,
    byteLength: bytes.byteLength,
    corrupt: false,
  };
  if (format === 'png') {
    const png = parsePngMetadata(bytes);
    if (png) inspection.png = png;
  }
  return inspection;
}

/**
 * Compact, model-facing summary. This is deliberately descriptive of the file
 * and never phrased as observation.
 */
export function describeImageMetadata(inspection: ImageInspection): string[] {
  const lines = [
    `format=${inspection.format.toUpperCase()} ${inspection.width}x${inspection.height} ${inspection.byteLength} bytes`,
  ];
  const generation = inspection.png?.generation;
  if (inspection.png?.software) lines.push(`software=${inspection.png.software}`);
  if (inspection.png?.source) lines.push(`source=${inspection.png.source}`);
  if (generation) {
    if (generation.model) lines.push(`model=${generation.model}`);
    if (generation.steps !== undefined) lines.push(`steps=${generation.steps}`);
    if (generation.scale !== undefined) lines.push(`scale=${generation.scale}`);
    if (generation.sampler) lines.push(`sampler=${generation.sampler}`);
    if (generation.seed !== undefined) lines.push(`seed=${generation.seed}`);
    if (generation.width !== undefined && generation.height !== undefined) {
      lines.push(`generated_size=${generation.width}x${generation.height}`);
    }
    if (generation.prompt) lines.push(`prompt=${generation.prompt.slice(0, 400)}`);
    if (generation.negativePrompt) lines.push(`negative_prompt=${generation.negativePrompt.slice(0, 200)}`);
  }
  return lines;
}