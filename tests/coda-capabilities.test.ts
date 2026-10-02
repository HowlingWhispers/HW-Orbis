// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCodaCapabilityContext,
  clearCodaCapabilityCache,
  fetchWeatherKnowledge,
  sanitizeCapabilityText,
  resolveLocalRepositories,
  searchLocalGithubKnowledge,
  searchRemoteGithubKnowledge,
  weatherLocation,
} from '../server/coda-capabilities';
import { loadConfig } from '../server/config';

const remoteToken = 'github_pat_FAKE_TEST_CREDENTIAL_123456789';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5174',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  DISCORD_CLIENT_ID: '',
  DISCORD_CLIENT_SECRET: 'test',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  CODA_GITHUB_REMOTE_ENABLED: 'true',
  CODA_GITHUB_READ_TOKEN: remoteToken,
  CODA_GITHUB_ORG: 'HowlingWhispers',
  CODA_GITHUB_REPOSITORIES: 'HW-Orbis,HW-Coda',
  CODA_WEATHER_DEFAULT_LOCATION: 'Bremen, Germany',
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => clearCodaCapabilityCache());

/**
 * A throwaway git repository standing in for a Howling Whispers checkout.
 *
 * The search is a real `git grep` against real files on disk, so the honest way
 * to test it anywhere is to give it somewhere to look. Building a fixture here
 * keeps the test meaningful on a CI runner with no `/srv/howling-whispers`,
 * instead of quietly asserting nothing.
 */
let fixtureRoot = '';
let fixtureRepository = { name: 'HW-Fixture', root: '' };

function git(args: string[], cwd: string) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'coda-capability-'));
  const root = path.join(fixtureRoot, 'server');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'fixture-capability.ts'),
    'export function fixtureQuokkaCapability() {\n  return "quokka-capability-marker";\n}\n');
  writeFileSync(path.join(fixtureRoot, '.env'), 'FIXTURE_TOKEN=should-never-be-cited\n');
  git(['init', '--quiet'], fixtureRoot);
  git(['config', 'user.email', 'fixture@example.invalid'], fixtureRoot);
  git(['config', 'user.name', 'Fixture'], fixtureRoot);
  git(['add', '-A'], fixtureRoot);
  git(['commit', '--quiet', '-m', 'Add fixture capability source'], fixtureRoot);
  fixtureRepository = { name: 'HW-Fixture', root: fixtureRoot };
});

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('Coda read-only GitHub capability', () => {
  it('searches tracked local source with repository and commit citations', () => {
    const result = searchLocalGithubKnowledge(
      'Where is fixtureQuokkaCapability implemented in source code?',
      [fixtureRepository],
    );
    expect(result).toContain('[local HW-Fixture');
    expect(result).toContain('server/fixture-capability.ts');
    expect(result).toContain('fixtureQuokkaCapability');
    expect(result).toContain('commit');
    // The fixture deliberately contains a .env; citation must still skip it.
    expect(result).not.toContain('should-never-be-cited');
    expect(result).not.toMatch(/(?:^|\/)\.env/);
  });

  it('cites the commit it actually read', () => {
    const head = git(['rev-parse', '--short=12', 'HEAD'], fixtureRoot).trim();
    const result = searchLocalGithubKnowledge('fixtureQuokkaCapability implementation', [fixtureRepository]);
    expect(result).toContain(head);
  });

  it('returns nothing rather than inventing evidence when the root has no repository', () => {
    const result = searchLocalGithubKnowledge(
      'fixtureQuokkaCapability implementation',
      [{ name: 'HW-Absent', root: path.join(fixtureRoot, 'not-a-checkout') }],
    );
    expect(result).toBe('');
  });

  it('takes its roots from configuration instead of a hardcoded server path', () => {
    const configured = resolveLocalRepositories({ CODA_LOCAL_REPO_ROOTS: 'One=/tmp/one, Two=/tmp/two' });
    expect(configured).toEqual([{ name: 'One', root: '/tmp/one' }, { name: 'Two', root: '/tmp/two' }]);
  });

  it('keeps the production layout when the override is absent or unusable', () => {
    expect(resolveLocalRepositories({}).some(repository => repository.name === 'HW-Orbis')).toBe(true);
    expect(resolveLocalRepositories({ CODA_LOCAL_REPO_ROOTS: '   ' }).some(repository => repository.name === 'HW-Orbis')).toBe(true);
    // A malformed override must not silently disable the capability.
    expect(resolveLocalRepositories({ CODA_LOCAL_REPO_ROOTS: 'no-separator-here' }).some(repository => repository.name === 'HW-Orbis')).toBe(true);
  });

  it('uses a server-side GitHub credential but never returns it in evidence', async () => {
    const authorizations: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      authorizations.push(new Headers(init?.headers).get('authorization') || '');
      if (url.pathname === '/search/code') {
        return json({ items: [
          {
            repository: { full_name: 'HowlingWhispers/HW-Orbis' },
            path: 'server/coda-runtime.ts',
            html_url: 'https://github.com/HowlingWhispers/HW-Orbis/blob/main/server/coda-runtime.ts',
            text_matches: [{ fragment: `const token = "${remoteToken}"; executeCodaOperations()` }],
          },
          {
            repository: { full_name: 'OtherOrg/private' }, path: '.env', html_url: 'https://example.invalid',
          },
        ] });
      }
      if (url.pathname === '/search/issues') {
        return json({ items: [{
          repository_url: 'https://api.github.com/repos/HowlingWhispers/HW-Orbis',
          number: 42,
          title: 'Keep runtime writes validated',
          state: 'open',
          updated_at: '2026-09-30T20:00:00Z',
          html_url: 'https://github.com/HowlingWhispers/HW-Orbis/issues/42',
        }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await searchRemoteGithubKnowledge('Find GitHub code and issues for Coda runtime validation', config, fetchMock as typeof fetch);

    expect(authorizations).toEqual([`Bearer ${remoteToken}`, `Bearer ${remoteToken}`]);
    expect(result).toContain('HowlingWhispers/HW-Orbis/server/coda-runtime.ts');
    expect(result).toContain('HW-Orbis #42');
    expect(result).toContain('[credential omitted]');
    expect(result).not.toContain(remoteToken);
    expect(result).not.toContain('OtherOrg');
  });

  it('redacts common credential forms from retrieved text', () => {
    const raw = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz token=abcdefghijklmnop github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const result = sanitizeCapabilityText(raw);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result).not.toContain('abcdefghijklmnop');
    expect(result).not.toContain('github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });
});

describe('Coda weather capability', () => {
  it('extracts an explicit place and otherwise uses the configured default', () => {
    expect(weatherLocation('What is the weather in Berlin tomorrow?', 'Bremen')).toBe('Berlin');
    expect(weatherLocation('Will it rain tonight?', 'Bremen, Germany')).toBe('Bremen, Germany');
  });

  it('returns current conditions and a cited forecast from Open-Meteo', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === 'geocoding-api.open-meteo.com') {
        expect(url.searchParams.get('name')).toBe('Berlin');
        return json({ results: [{ name: 'Berlin', admin1: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.41 }] });
      }
      if (url.hostname === 'api.open-meteo.com') {
        return json({
          timezone: 'Europe/Berlin',
          current: { temperature_2m: 14, apparent_temperature: 13, relative_humidity_2m: 70, precipitation: 0, weather_code: 1, wind_speed_10m: 8 },
          current_units: { temperature_2m: '°C', apparent_temperature: '°C', precipitation: 'mm', wind_speed_10m: 'km/h' },
          daily: {
            time: ['2026-10-01'], weather_code: [2], temperature_2m_max: [17], temperature_2m_min: [9],
            precipitation_probability_max: [20], sunrise: ['2026-10-01T07:05'], sunset: ['2026-10-01T18:42'],
          },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await fetchWeatherKnowledge('Coda, what is the weather in Berlin today?', config, fetchMock as typeof fetch);

    expect(result).toContain('Open-Meteo');
    expect(result).toContain('Berlin, Berlin, Germany');
    expect(result).toContain('14°C');
    expect(result).toContain('sunrise');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('combines provider-independent evidence and tolerates unavailable capabilities', async () => {
    const disabled = loadConfig({
      NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters', DISCORD_CLIENT_ID: '', DISCORD_CLIENT_SECRET: 'test',
      DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback', CODA_GITHUB_REMOTE_ENABLED: 'false',
    });
    const result = await buildCodaCapabilityContext('What does the project code do?', disabled, {
      localSearch: () => '[local test] source.ts:10:answer',
      fetch: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch,
    });
    expect(result).toContain('READ-ONLY LOCAL REPOSITORY EVIDENCE');
    expect(result).toContain('source.ts:10:answer');
    expect(result).not.toContain('REMOTE GITHUB');
  });
});
