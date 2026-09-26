export const CODA_MESSAGE_MAX_LENGTH = 4000;
export const CODA_COMPOSED_MAX_LENGTH = 12000;

export function splitCodaMessageContent(content: string, limit = CODA_MESSAGE_MAX_LENGTH): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];

  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const size = breakAt > Math.floor(limit / 2) ? breakAt : limit;
    parts.push(rest.slice(0, size).trimEnd());
    rest = rest.slice(size).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function codaMessagePartCount(content: string, splitLongMessages: boolean): number {
  if (!splitLongMessages) return 1;
  return Math.max(splitCodaMessageContent(content).length, content.trim() ? 1 : 0);
}
