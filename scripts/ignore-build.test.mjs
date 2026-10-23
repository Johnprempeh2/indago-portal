import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./ignore-build.mjs', import.meta.url))

test('docs-only changes skip; site changes build', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'indago-ignore-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), 'one\n')
  git('add', 'README.md')
  git('commit', '-qm', 'Initial')
  const first = git('rev-parse', 'HEAD')
  writeFileSync(join(repo, 'README.md'), 'two\n')
  mkdirSync(join(repo, 'docs'))
  writeFileSync(join(repo, 'docs', 'guide.md'), 'guide\n')
  git('add', '.')
  git('commit', '-qm', 'Docs')
  const docs = git('rev-parse', 'HEAD')
  const check = (previous, current) => spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, CACHED_COMMIT_REF: previous, COMMIT_REF: current },
  }).status
  assert.equal(check(first, docs), 0)
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'App.jsx'), 'export default function App() {}\n')
  git('add', '.')
  git('commit', '-qm', 'Site')
  assert.equal(check(docs, git('rev-parse', 'HEAD')), 1)
  assert.equal(check('', docs), 1)
})
