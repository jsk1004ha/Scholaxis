import { writeFile } from 'node:fs/promises';
import { buildPostgresMigrationSql } from '../src/postgres-migration.mjs';

const outputPath = process.argv[2] || '.data/postgres-migration.sql';
const sql = buildPostgresMigrationSql();

await writeFile(outputPath, sql, 'utf8');
console.log(`PostgreSQL migration bundle written to ${outputPath}`);
