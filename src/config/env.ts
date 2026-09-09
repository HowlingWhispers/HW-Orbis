const normalizedBaseUrl = (import.meta.env.VITE_ORBIS_API_URL ?? import.meta.env.VITE_HW_LIBRARY_API_URL ?? '').trim().replace(/\/$/, '');

export const appConfig = {
  apiBaseUrl: normalizedBaseUrl,
  usesFixtures: normalizedBaseUrl.length === 0,
} as const;
