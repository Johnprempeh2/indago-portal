// Makes one Deep Dive MCP token on your own machine. The token goes only into your password manager and
// the GSAM connection; the database is given its SHA-256 hash, never the token.
// Usage: node scripts/make-mcp-token.mjs "<label, e.g. Deep Dive agent>" [engagement]
import { createHash, randomBytes } from 'node:crypto';

const [label, engagement = 'indago'] = process.argv.slice(2);
if (!label || label.length > 120 || !/^[a-z0-9-]{1,40}$/.test(engagement)) {
  console.error('Usage: node scripts/make-mcp-token.mjs "<label>" [engagement]');
  process.exit(1);
}
const token = `gsdd_${randomBytes(32).toString('hex')}`;
const hash = createHash('sha256').update(token).digest('hex');
const sql = `SELECT indago.mcp_register_token(${quote(label)}, ${quote(engagement)}, '${hash}');`;
console.log(`Token (store it now; it is not shown again):\n${token}\n\nSQL for the approved database operation (hash only):\n${sql}`);

function quote(s) { return `'${s.replace(/'/g, "''")}'`; }
