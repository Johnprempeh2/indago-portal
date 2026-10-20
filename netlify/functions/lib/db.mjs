import { getDatabase } from '@netlify/database';

// The platform connection always wins over a developer's local DATABASE_URL.
const netlify = process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED;
export const db = getDatabase(!netlify && process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : undefined);
