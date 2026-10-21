import { AsyncLocalStorage } from 'node:async_hooks';

const capture = new AsyncLocalStorage();
export const qaDomain = '@indago-test.invalid';

export function captureQaLinks(work) {
  const links = new Map();
  return capture.run(links, async () => ({ result: await work(), links }));
}

export function captureQaLink(email, url) {
  if (!email.endsWith(qaDomain)) return false;
  const links = capture.getStore();
  if (!links) throw new Error('Synthetic QA link requested outside the gated route');
  links.set(email, url);
  return true;
}
