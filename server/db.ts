import pg from 'pg';

export const createPool = (connectionString: string) => new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export type DatabasePool = ReturnType<typeof createPool>;
