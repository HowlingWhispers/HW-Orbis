import { appConfig } from '../config/env';
import type { AssetImage } from '../types/library';

/** Card and hero cover artwork is cropped responsively at 16:9. */
export const COVER_ASPECT_RATIO = 16 / 9;

export const PREFERRED_COVER_WIDTHS = [1600, 1280] as const;

/**
 * Local images are served from an Orbis media route path, so they need the API
 * origin prepended when the web app and API are hosted separately. External
 * image URLs are already absolute and are used unchanged.
 */
export function assetImageUrl(image: AssetImage | undefined) {
  if (!image?.url) return '';
  return image.url.startsWith('/') ? `${appConfig.apiBaseUrl}${image.url}` : image.url;
}

/**
 * CSS `object-position` for a cover image, from its stored focal point. This is
 * what keeps a face or subject inside the visible frame once a 16:9 crop and
 * `object-fit: cover` trim the rest; the image is never stretched.
 */
export function coverObjectPosition(image: AssetImage | undefined) {
  const x = Math.min(Math.max(image?.focalX ?? 0.5, 0), 1) * 100;
  const y = Math.min(Math.max(image?.focalY ?? 0.5, 0), 1) * 100;
  return `${x.toFixed(2)}% ${y.toFixed(2)}%`;
}

/** Alt text for artwork, falling back to something descriptive rather than empty. */
export function coverAltText(image: AssetImage | undefined, recordName: string) {
  const alt = image?.altText?.trim();
  if (alt) return alt;
  const caption = image?.caption?.trim();
  if (caption) return caption;
  return `Cover artwork for ${recordName}`;
}

export function coverAdvice(image: AssetImage | undefined) {
  if (!image || !image.width || !image.height) return undefined;
  if ((PREFERRED_COVER_WIDTHS as readonly number[]).includes(image.width) && image.height === image.width / COVER_ASPECT_RATIO) {
    return undefined;
  }
  if (Math.abs(image.width / image.height - COVER_ASPECT_RATIO) <= 0.02) return undefined;
  return `Card artwork is cropped at 16:9. 1600x900 or 1280x720 keeps the whole frame; this image is ${image.width}x${image.height}.`;
}

export function formatImageSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
