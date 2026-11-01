import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

const sites = new Set(['greatstone-indago-portal', 'greatstone-indago-preview'])
const mikeyId = '8950d7f0-4d3b-40b0-93d8-b67aead0a2f7'
const johnId = 'UGJwnXKO0P0yBvVh4krv4LH3EThDwrRP'
const [site, number] = process.argv.slice(2)
const token = process.env.NETLIFY_AUTH_TOKEN
const api = process.env.NODE_ENV === 'test' && token === 'test'
  ? process.env.NETLIFY_TEST_API_URL : 'https://api.netlify.com'
const gsam = process.env.GSAM_API_URL?.replace(/\/?api\/?$/, '').replace(/\/$/, '')

function command(bin, args) {
  return execFileSync(bin, args, { encoding: 'utf8' }).trim()
}

async function request(url, auth, method = 'GET') {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${auth}` } })
  if (!response.ok) throw new Error(`${method} ${new URL(url).pathname}: ${response.status}`)
  return response.json()
}

function nonSite(file) {
  return file.endsWith('.md') || file.startsWith('docs/') || file.startsWith('.github/') ||
    file.startsWith('netlify/database/tests/') || /(?:^|\/)\S+\.test\.[^/]+$/.test(file)
}

async function main() {
  if (!sites.has(site) || !/^\d+$/.test(number || ''))
    throw new Error('usage: node scripts/deploy-preview.mjs <allowed site> <PR number>')
  if (!token || !gsam || !process.env.GSAM_API_KEY || !process.env.GSAM_TASK_ID)
    throw new Error('Netlify and GSAM task credentials are required')
  if (command('git', ['status', '--porcelain'])) throw new Error('a clean checkout is required')
  const sha = command('git', ['rev-parse', 'HEAD'])
  const pr = JSON.parse(command('gh', ['pr', 'view', number, '--repo', 'Johnprempeh2/indago-portal',
    '--json', 'number,state,isDraft,headRefOid,baseRefOid,baseRefName,labels']))
  if (pr.state !== 'OPEN' || pr.isDraft || pr.baseRefName !== 'main' || pr.headRefOid !== sha)
    throw new Error('preview requires an open, non-draft PR at this exact commit')
  const comments = await request(`${gsam}/api/issues/${process.env.GSAM_TASK_ID}/comments`, process.env.GSAM_API_KEY)
  const ready = pr.labels.some((label) => label.name === 'preview') || comments.some((comment) =>
    ((comment.authorType === 'user' && comment.authorUserId === johnId) ||
      (comment.authorType === 'agent' && comment.authorAgentId === mikeyId)) &&
    comment.body.trim() === `Preview ready for PR #${number}`)
  if (!ready) throw new Error('preview refused: add the preview label or get Mikey or John to mark it ready')

  const target = await request(`${api}/api/v1/sites/${site}.netlify.app`, token)
  if (target.name !== site || !/^[0-9a-f-]{36}$/.test(target.id)) throw new Error('Netlify site identity mismatch')
  const deploys = await request(`${api}/api/v1/sites/${target.id}/deploys?per_page=100`, token)
  const marker = new RegExp(`^gsam-source:preview:${number}:([0-9a-f]{40})$`)
  for (const deploy of deploys) {
    if (!marker.test(deploy.title || '') || !['new', 'enqueued', 'building', 'uploading', 'processing', 'preparing'].includes(deploy.state)) continue
    await request(`${api}/api/v1/deploys/${deploy.id}/cancel`, token, 'POST')
    console.log(`Cancelled stale deploy ${deploy.id}`)
  }
  const readyDeploy = deploys.find((deploy) => deploy.state === 'ready' && marker.test(deploy.title || ''))
  const baseline = readyDeploy ? marker.exec(readyDeploy.title)[1] : pr.baseRefOid
  command('git', ['cat-file', '-e', `${baseline}^{commit}`])
  const files = command('git', ['diff', '--name-only', baseline, sha, '--']).split('\n').filter(Boolean)
  if (!files.length || files.every(nonSite)) {
    console.log(`Skipped ${site}: ${files.length ? 'non-site files only' : 'no changes'}`)
    return
  }
  command('npm', ['run', 'build'])
  const message = `gsam-source:preview:${number}:${sha}`
  // The build above is at the exact PR head. Rebuilding inside Netlify CLI also
  // tries to write .netlify in the shared parent checkout outside this worktree.
  // Netlify CLI resolves .netlify from the shared Git checkout even when the
  // content is in this managed worktree. Give it a disposable project root.
  const project = mkdtempSync(join(process.env.GSAM_RUN_SCRATCH_DIR || tmpdir(), 'indago-preview-'))
  copyFileSync('netlify.toml', join(project, 'netlify.toml'))
  let result
  try {
    await build({
      entryPoints: readdirSync('netlify/functions').filter((file) => file.endsWith('.mjs'))
        .map((file) => join('netlify/functions', file)),
      outdir: join(project, 'functions'),
      outExtension: { '.js': '.mjs' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
    result = spawnSync('netlify', ['deploy', '--no-build', '--dir', resolve('dist'),
      '--functions', join(project, 'functions'), '--site', target.id, '--message', message],
    { stdio: 'inherit', cwd: project })
  } finally { rmSync(project, { recursive: true, force: true }) }
  if (result.status !== 0) throw new Error(`netlify deploy failed: ${result.error?.message || result.status}`)
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
