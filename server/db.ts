import pg from 'pg';

export const createPool = (connectionString: string) => new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export type DatabasePool = ReturnType<typeof createPool>;
export type DatabaseClient = pg.PoolClient;

/**
 * The subset shared by pg.Pool and pg.PoolClient. Helpers that only issue queries
 * should accept this instead of forcing callers out of a transaction.
 */
export type DatabaseExecutor = Pick<DatabasePool, 'query'>;
