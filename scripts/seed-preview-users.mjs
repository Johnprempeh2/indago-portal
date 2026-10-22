import { previewUsers } from '../netlify/functions/lib/preview-login.mjs';

if (process.env.INDAGO_TEST_LOGIN !== '1' ||
    process.env.INDAGO_TEST_LOGIN_HOST !== 'greatstone-indago-portal.netlify.app' ||
    process.env.INDAGO_SEED_MODE !== '1' ||
    !process.env.BETTER_AUTH_SECRET ||
    !process.env.BETTER_AUTH_URL?.startsWith('https://greatstone-indago-portal.netlify.app') ||
    !(process.env.NETLIFY_DB_URL || process.env.DATABASE_URL)) {
  throw new Error('Preview seed configuration is incomplete');
}

const passwords = {
  editor: process.env.INDAGO_TEST_EDITOR_PASSWORD,
  viewer: process.env.INDAGO_TEST_VIEWER_PASSWORD,
};
if (Object.values(passwords).some(value => !value || value.length < 16) ||
    passwords.editor === passwords.viewer) {
  throw new Error('Set two distinct preview passwords of at least 16 characters');
}

const { db } = await import('../netlify/functions/lib/db.mjs');
const { auth } = await import('../netlify/functions/lib/auth.mjs');
try {
  for (const role of ['editor', 'viewer']) {
    const email = previewUsers[role];
    await db.pool.query(`INSERT INTO indago.members(email, role, facilitator) VALUES($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, facilitator = EXCLUDED.facilitator`, [email, role, role === 'editor']);
    const existing = await db.pool.query('SELECT 1 FROM "user" WHERE email = $1', [email]);
    if (!existing.rows.length) {
      await auth.api.signUpEmail({ body: {
        name: `Preview ${role}`,
        email,
        password: passwords[role],
      } });
    }
  }
  console.log('Preview Editor and Viewer accounts are ready.');
} finally {
  await db.pool.end();
}
