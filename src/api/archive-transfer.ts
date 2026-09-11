import { appConfig } from '../config/env';
import { LibraryApiError } from './contracts';

function filenameFrom(response: Response, fallback: string) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/i);
  return match?.[1] ?? fallback;
}

async function responseError(response: Response) {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return new LibraryApiError(data.error ?? `Archive request failed with status ${response.status}.`, response.status);
}

async function saveDownload(path: string, fallback: string) {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/octet-stream' },
  });
  if (!response.ok) throw await responseError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFrom(response, fallback);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadRecordArchive(assetId: string) {
  return saveDownload(`/v1/library/transfer/assets/${encodeURIComponent(assetId)}`, 'orbis-record.orbis.json');
}

export function downloadAccountArchive() {
  return saveDownload('/v1/library/transfer/account', 'orbis-account.orbis.json');
}

export async function uploadArchive(file: File) {
  const response = await fetch(`${appConfig.apiBaseUrl}/v1/library/transfer/import`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
    body: file,
  });
  const data = await response.json().catch(() => ({})) as { imported?: number; sha256?: string; error?: string };
  if (!response.ok || typeof data.imported !== 'number') throw new LibraryApiError(data.error ?? `Archive request failed with status ${response.status}.`, response.status);
  return { imported: data.imported, sha256: data.sha256 ?? '' };
}
