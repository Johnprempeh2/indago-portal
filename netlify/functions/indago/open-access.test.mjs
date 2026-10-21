import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
const { withMember } = await import('../indago.mjs');

test('switch off requires a session without opening the database', async () => {
  const pool = { connect() { throw Error('database should not be reached'); } };
  const response = await withMember(null, () => {}, false, pool);
  assert.equal(response.status, 401);
});

test('switch on grants anonymous editor access within one transaction', async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, values) { queries.push([sql, values]); return { rows: [] }; },
    release() { released = true; },
  };
  const pool = { async connect() { return client; } };
  const response = await withMember(null, (_client, role) => {
    assert.equal(_client, client);
    assert.equal(role, 'editor');
    return new Response('ok');
  }, true, pool);
  assert.equal(response.status, 200);
  assert.deepEqual(queries.map(([sql]) => sql), [
    'BEGIN', 'SET LOCAL ROLE indago_app',
    "SELECT set_config('indago.user_id', $1, true)",
    "SELECT set_config('indago.open_access', 'on', true)", 'COMMIT',
  ]);
  assert.deepEqual(queries[2][1], ['open-access']);
  assert.equal(released, true);
});
