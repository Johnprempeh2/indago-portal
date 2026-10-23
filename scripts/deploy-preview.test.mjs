import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./deploy-preview.mjs', import.meta.url))
const site = 'greatstone-indago-preview'

test('PR gate, change filter and stale Netlify cancellation', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'indago-preview-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, '.gitignore'), 'bin/\ndeploy.log\n')
  writeFileSync(join(dir, 'src/app.jsx'), 'one')
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  assert.equal(git('init', '-q', '-b', 'main').status, 0)
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('add', '.gitignore', 'src/app.jsx')
  git('commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD').stdout.trim()
  git('checkout', '-qb', 'pr')
  writeFileSync(join(dir, 'bin/gh'), '#!/bin/sh\nprintf "%s" "$FAKE_PR"\n', { mode: 0o755 })
  writeFileSync(join(dir, 'bin/npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  writeFileSync(join(dir, 'bin/netlify'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DEPLOY_LOG"\n', { mode: 0o755 })
  let deploys = []
  let cancelled = []
  let comments = []
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') cancelled.push(req.url)
    res.end(JSON.stringify(req.url.endsWith('/comments') ? comments :
      req.url.endsWith(`${site}.netlify.app`) ? { id: '21ae4ef9-7349-4349-8713-40619e1c0c07', name: site } : deploys))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}`
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    NODE_ENV: 'test', NETLIFY_AUTH_TOKEN: 'test', NETLIFY_TEST_API_URL: url, GSAM_API_URL: url,
    GSAM_API_KEY: 'test', GSAM_TASK_ID: 'test', DEPLOY_LOG: join(dir, 'deploy.log') }
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [script, site, '12'], { cwd: dir, env })
    let stdout = '', stderr = ''
    child.stdout.on('data', (part) => { stdout += part })
    child.stderr.on('data', (part) => { stderr += part })
    child.on('exit', (status) => resolve({ status, stdout, stderr }))
  })
  const commit = (file, content) => {
    writeFileSync(join(dir, file), content)
    git('add', file)
    git('commit', '-qm', 'change')
    env.FAKE_PR = JSON.stringify({ number: 12, state: 'OPEN', isDraft: false,
      headRefOid: git('rev-parse', 'HEAD').stdout.trim(), baseRefOid: base, baseRefName: 'main', labels: [{ name: 'preview' }] })
  }
  commit('README.md', 'docs')
  assert.match((await run()).stdout, /Skipped.*non-site files only/)
  commit('src/app.jsx', 'two')
  env.FAKE_PR = JSON.stringify({ ...JSON.parse(env.FAKE_PR), isDraft: true })
  assert.match((await run()).stderr, /non-draft PR/)
  env.FAKE_PR = JSON.stringify({ ...JSON.parse(env.FAKE_PR), isDraft: false, labels: [] })
  assert.match((await run()).stderr, /preview refused/)
  comments = [{ authorType: 'user', authorUserId: 'another-user', body: 'Preview ready for PR #12' }]
  assert.match((await run()).stderr, /preview refused/)
  comments = [{ authorType: 'agent', authorAgentId: 'another-agent', body: 'Preview ready for PR #12' }]
  assert.match((await run()).stderr, /preview refused/)
  comments = [{ authorType: 'user', authorUserId: 'UGJwnXKO0P0yBvVh4krv4LH3EThDwrRP', body: 'Preview ready for PR #12' }]
  assert.equal((await run()).status, 0)
  comments = [{ authorType: 'agent', authorAgentId: '8950d7f0-4d3b-40b0-93d8-b67aead0a2f7', body: 'Preview ready for PR #12' }]
  assert.equal((await run()).status, 0)
  comments = []
  env.FAKE_PR = JSON.stringify({ ...JSON.parse(env.FAKE_PR), labels: [{ name: 'preview' }] })
  deploys = [{ id: 'old', state: 'building', title: `gsam-source:preview:12:${base}` },
    { id: 'other', state: 'building', title: `gsam-source:preview:13:${base}` }]
  const result = await run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(cancelled, ['/api/v1/deploys/old/cancel'])
  assert.match(readFileSync(env.DEPLOY_LOG, 'utf8'), /deploy --site 21ae4ef9-7349-4349-8713-40619e1c0c07 --message gsam-source:preview:12:/)
})
