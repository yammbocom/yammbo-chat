// build-kb.mjs
// Walks help.yammbo.com docs, extracts frontmatter + body from each .mdx,
// emits src/kb-bundle.json keyed by language: { en: [...], es: [...] } and
// src/kb-version.json ({ hash, builtAt, counts }) used by the scheduled reindex
// to detect a changed KB. Every doc carries its public `url` on help.yammbo.com.
//
// Run from repo root:
//   HELP_REPO=/root/repos/help.yammbo.com node scripts/build-kb.mjs
// Or with default path:
//   node scripts/build-kb.mjs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import matter from 'gray-matter';

const HELP_REPO = process.env.HELP_REPO || '/root/repos/help.yammbo.com';
const DOCS_ROOT = join(HELP_REPO, 'src/content/docs');
const OUT_PATH = new URL('../src/kb-bundle.json', import.meta.url).pathname;
const VERSION_PATH = new URL('../src/kb-version.json', import.meta.url).pathname;
const HELP_ORIGIN = 'https://help.yammbo.com';

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && /\.(mdx?|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripMdx(body) {
  // Remove import statements, JSX components, HTML comments.
  // Conservative: strip lines starting with import, lines that are JSX-only.
  return body
    .split('\n')
    .filter((line) => !/^\s*import\s+/.test(line))
    .filter((line) => !/^\s*<[A-Z][A-Za-z0-9]*[\s/>]/.test(line))
    .filter((line) => !/^\s*<\/[A-Z][A-Za-z0-9]*>/.test(line))
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Relative help-site links → absolute, so the model cites real URLs.
    .replace(/\]\(\/docs\//g, `](${HELP_ORIGIN}/docs/`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugFromPath(filePath) {
  // /content/docs/en/web/overview.mdx → en/web/overview
  const rel = relative(DOCS_ROOT, filePath).replace(/\\/g, '/');
  return rel.replace(/\.(mdx?|md)$/, '');
}

function langFromSlug(slug) {
  return slug.split('/')[0] === 'es' ? 'es' : 'en';
}

async function main() {
  console.log(`Reading docs from: ${DOCS_ROOT}`);
  const files = (await walk(DOCS_ROOT)).sort();
  console.log(`Found ${files.length} doc files`);

  const bundle = { en: [], es: [] };
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const { data, content } = matter(raw);
    const slug = slugFromPath(file);
    const lang = langFromSlug(slug);
    const cleanBody = stripMdx(content);
    bundle[lang].push({
      slug,
      url: `${HELP_ORIGIN}/docs/${slug}/`,
      title: data.title || slug.split('/').pop(),
      description: data.description || '',
      product: slug.split('/')[1] || 'general',
      body: cleanBody,
    });
  }

  // Sort each language by product/slug for deterministic output
  for (const lang of Object.keys(bundle)) {
    bundle[lang].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const json = JSON.stringify(bundle, null, 2);
  const totalChars = json.length;
  await writeFile(OUT_PATH, json);

  const version = {
    hash: createHash('sha256').update(json).digest('hex'),
    builtAt: new Date().toISOString(),
    counts: { en: bundle.en.length, es: bundle.es.length },
  };
  await writeFile(VERSION_PATH, JSON.stringify(version, null, 2) + '\n');

  console.log(`KB bundle written: ${OUT_PATH}`);
  console.log(`  EN docs: ${bundle.en.length}`);
  console.log(`  ES docs: ${bundle.es.length}`);
  console.log(`KB version written: ${VERSION_PATH} (${version.hash.slice(0, 12)})`);
  console.log(`  Total size: ${(totalChars / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
