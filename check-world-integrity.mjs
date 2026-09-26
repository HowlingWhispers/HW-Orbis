#!/usr/bin/env node
/**
 * Read-only integrity check for canonical world children and World Forge projections.
 * Requires the real DATABASE_URL explicitly; there is deliberately no fallback DB.
 *
 * Usage:
 *   DATABASE_URL=... npm run check:world-integrity
 *   DATABASE_URL=... npm run check:world-integrity -- <world-uuid>
 */

import { createPool } from './dist-server/db.js';
import { inspectWorldIntegrity } from './dist-server/world-integrity.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Refusing to guess a database.');
  process.exit(2);
}

const worldId = process.argv[2]?.trim() || undefined;
const pool = createPool(databaseUrl);

try {
  const report = await inspectWorldIntegrity(pool, worldId);
  console.log(`Worlds: ${report.worlds}`);
  console.log(`Embedded projections: ${report.embeddedEntries}`);
  console.log(`Canonical child rows: ${report.canonicalRows}`);
  console.log(`Errors: ${report.errors} · Warnings: ${report.warnings}`);

  for (const issue of report.issues) {
    const prefix = issue.severity === 'error' ? 'ERROR' : 'WARN ';
    console.log(`${prefix} ${issue.worldName} / ${issue.collection} / ${issue.code}: ${issue.message}`);
  }

  if (report.errors) process.exitCode = 1;
} finally {
  await pool.end();
}
