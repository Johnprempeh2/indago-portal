import { previewUsers } from '../netlify/functions/lib/preview-login.mjs';

if (process.env.INDAGO_REMOVE_PREVIEW_USERS !== '1' ||
    process.env.INDAGO_TEST_LOGIN === '1' ||
    process.env.INDAGO_TEST_LOGIN_HOST !== 'greatstone-indago-preview.netlify.app' ||
    !(process.env.NETLIFY_DB_URL || process.env.DATABASE_URL)) {
  throw new Error('Turn off preview login and set the preview removal configuration first');
}

const { db } = await import('../netlify/functions/lib/db.mjs');
const client = await db.pool.connect();
try {
  await client.query('BEGIN');
  for (const email of Object.values(previewUsers)) {
    await client.query('DELETE FROM indago.members WHERE email = $1', [email]);
    // Better Auth cascades sessions and accounts from its user row.
    await client.query('DELETE FROM "user" WHERE email = $1', [email]);
  }
  await client.query('COMMIT');
  console.log('Preview Editor and Viewer accounts and memberships removed.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.pool.end();
}
