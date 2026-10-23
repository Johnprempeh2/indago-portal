import { execFileSync } from 'node:child_process'

const ignored = (path) =>
  path.endsWith('.md') ||
  path.startsWith('docs/') ||
  path.startsWith('.github/') ||
  path.startsWith('netlify/database/tests/') ||
  /(?:^|\/)\S+\.test\.[^/]+$/.test(path)

const { CACHED_COMMIT_REF: previous, COMMIT_REF: current } = process.env

// Without a usable cached commit, build so a site change cannot be missed.
if (!previous || !current || previous === current) process.exit(1)

try {
  const files = execFileSync('git', ['diff', '--name-only', previous, current, '--'], {
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean)
  process.exit(files.length > 0 && files.every(ignored) ? 0 : 1)
} catch {
  process.exit(1)
}
