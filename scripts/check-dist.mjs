import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const forbidden = /BETTER_AUTH_SECRET|RESEND_API_KEY|DATABASE_URL|NETLIFY_AUTH_TOKEN|VITE_SUPABASE_|@supabase\/supabase-js|IND-EV-009: technology to make delivery seamless|If Indago ceased conducting surveys tomorrow/;
let scanned = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else {
      scanned++;
      if (forbidden.test(await readFile(path, 'utf8'))) throw Error(`Server configuration or internal facilitator text in browser build: ${path}`);
    }
  }
}
await scan('dist');
console.log(`Browser build check passed: scanned ${scanned} files.`);
