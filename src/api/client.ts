import { appConfig } from '../config/env';
import type { LibraryApi } from './contracts';
import { FixtureLibraryApi } from './fixture-client';
import { HttpLibraryApi } from './http-client';

export const libraryApi: LibraryApi = appConfig.usesFixtures
  ? new FixtureLibraryApi()
  : new HttpLibraryApi(appConfig.apiBaseUrl);
