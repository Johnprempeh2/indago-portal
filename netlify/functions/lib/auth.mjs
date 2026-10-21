import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { db } from './db.mjs';
import { Resend } from 'resend';

export const auth = betterAuth({
  database: db.pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [process.env.BETTER_AUTH_URL].filter(Boolean),
  // Preview accounts are seeded in a separate process. Public sign-up stays closed.
  emailAndPassword: {
    enabled: process.env.INDAGO_TEST_LOGIN === '1',
    disableSignUp: process.env.INDAGO_SEED_MODE !== '1',
  },
  databaseHooks: {
    user: {
      create: {
        before: async user => {
          const { rows } = await db.pool.query(
            'SELECT 1 FROM indago.members WHERE email = lower($1)', [user.email],
          );
          if (!rows.length) return false;
        },
      },
    },
  },
  plugins: [magicLink({
    storeToken: 'hashed',
    sendMagicLink: async ({ email, url }) => {
      const { rows } = await db.pool.query(
        'SELECT 1 FROM indago.members WHERE email = lower($1)', [email],
      );
      if (!rows.length) return;
      if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
        throw new Error('Email delivery is not configured');
      }
      const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.RESEND_FROM,
        to: email,
        subject: 'Your Greatstone Indago sign-in link',
        text: `Use this link to sign in to your Greatstone Indago portal: ${url}`,
      });
      if (error) throw new Error('Email delivery failed');
    },
  })],
});
