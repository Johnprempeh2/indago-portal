import { getDatabase } from '@netlify/database';

// The platform connection always wins over a developer's local DATABASE_URL.
const netlify = process.env.NETLIFY_DB_URL;
export const db = getDatabase(!netlify && process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : undefined);
