// rag.ts
// Retrieval-Augmented Generation over the Help Center KB.
//
// Instead of dumping every doc (~6-8k tokens) into the system prompt on every
// turn, we embed the KB once into a Vectorize index (bge-m3, multilingual,
// 1024 dims) and, per question, retrieve only the few most relevant chunks.
//
// - reindexKb()  — (re)builds the index from kb-bundle.json. Idempotent: chunk
//                  ids are deterministic, so a re-run upserts in place AND
//                  deletes chunks that no longer exist (a doc shrank / a slug
//                  was removed) by diffing against the id list kept in KV.
// - retrieve()   — embeds the user's question and returns the top-k chunks for
//                  the detected language, filtered via the `lang` metadata index.
//
// bge-m3 caps input at 512 tokens, so chunks are kept small (~1400 chars).

import kbBundle from './kb-bundle.json';

type Lang = 'en' | 'es';
type KbDoc = { slug: string; url: string; title: string; description: string; product: string; body: string };
type KbBundle = Record<Lang, KbDoc[]>;
const KB = kbBundle as KbBundle;
const LIVE_SLUGS = new Set([...KB.en, ...KB.es].map((d) => d.slug));

export const EMBED_MODEL = '@cf/baai/bge-m3';
const MAX_CHUNK_CHARS = 1400; // keep each chunk well under bge-m3's 512-token cap
const EMBED_BATCH = 50; // texts per Workers AI embedding call
const UPSERT_BATCH = 100; // vectors per Vectorize upsert call

export interface RagEnv {
  AI: Ai;
  KB_INDEX: VectorizeIndex;
  // Reused for RAG state: the id list of the last reindex, to purge orphans.
  CHAT_SESSIONS?: KVNamespace;
}

// KV key holding the JSON array of vector ids written by the last reindex.
const INDEX_IDS_KEY = '__rag_index_ids';

// A retrieved chunk, as surfaced to the prompt builder.
export interface KbChunk {
  slug: string;
  title: string;
  product: string;
  text: string;
  score?: number;
}

// ─── Chunking ─────────────────────────────────────────────────────────────

// Splits a doc body into heading-bounded sections, then caps each section to
// MAX_CHUNK_CHARS by paragraph so no chunk exceeds the embedding token limit.
// Each chunk text is prefixed with the doc title so the embedding (and the LLM)
// keep the topic in view even for a mid-doc section.
function chunkBody(body: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of body.split('\n')) {
    if (/^#{2,3}\s/.test(line) && current.length) {
      sections.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current.join('\n').trim());

  const chunks: string[] = [];
  for (const sec of sections) {
    if (!sec) continue;
    if (sec.length <= MAX_CHUNK_CHARS) {
      chunks.push(sec);
      continue;
    }
    // Section too long — pack paragraphs greedily up to the cap.
    let buf = '';
    for (const para of sec.split(/\n{2,}/)) {
      if (buf && (buf.length + para.length + 2) > MAX_CHUNK_CHARS) {
        chunks.push(buf.trim());
        buf = '';
      }
      buf += (buf ? '\n\n' : '') + para;
      // A single paragraph longer than the cap: hard-split it.
      while (buf.length > MAX_CHUNK_CHARS) {
        chunks.push(buf.slice(0, MAX_CHUNK_CHARS).trim());
        buf = buf.slice(MAX_CHUNK_CHARS);
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks;
}

interface PreparedChunk {
  id: string;
  text: string; // what we embed (title + section)
  body: string; // section only, surfaced to the answer prompt
  lang: Lang;
  slug: string;
  title: string;
  product: string;
}

// Flattens the whole KB into deterministically-id'd chunks ready to embed.
function prepareChunks(): PreparedChunk[] {
  const out: PreparedChunk[] = [];
  for (const lang of ['en', 'es'] as Lang[]) {
    for (const doc of KB[lang] || []) {
      const parts = chunkBody(doc.body);
      parts.forEach((body, i) => {
        out.push({
          id: `${lang}:${doc.slug}#${i}`,
          text: `${doc.title}\n\n${body}`,
          body,
          lang,
          slug: doc.slug,
          title: doc.title,
          product: doc.product,
        });
      });
    }
  }
  return out;
}

// ─── Embedding ──────────────────────────────────────────────────────────────

async function embed(env: RagEnv, texts: string[]): Promise<number[][]> {
  const res = (await env.AI.run(EMBED_MODEL, { text: texts })) as { data: number[][] };
  if (!res || !Array.isArray(res.data)) throw new Error('embedding: unexpected AI response');
  return res.data;
}

// ─── Reindex ──────────────────────────────────────────────────────────────

export interface ReindexResult {
  docs: number;
  chunks: number;
  upserted: number;
  deletedOrphans: number;
  mutationId?: string;
  langs: Record<Lang, number>;
}

// (Re)builds the whole index from the bundled KB. Safe to call repeatedly.
export async function reindexKb(env: RagEnv): Promise<ReindexResult> {
  const prepared = prepareChunks();
  const langs: Record<Lang, number> = { en: 0, es: 0 };
  for (const p of prepared) langs[p.lang]++;

  let upserted = 0;
  let mutationId: string | undefined;
  for (let i = 0; i < prepared.length; i += EMBED_BATCH) {
    const batch = prepared.slice(i, i + EMBED_BATCH);
    const vectors = await embed(env, batch.map((b) => b.text));
    const toUpsert: VectorizeVector[] = batch.map((b, j) => ({
      id: b.id,
      values: vectors[j],
      metadata: {
        lang: b.lang,
        slug: b.slug,
        title: b.title,
        product: b.product,
        text: b.body,
      },
    }));
    for (let k = 0; k < toUpsert.length; k += UPSERT_BATCH) {
      const slice = toUpsert.slice(k, k + UPSERT_BATCH);
      // The installed workers-types ship the beta mutation shape ({ids,count}),
      // but the v2 runtime returns { mutationId }. Read it defensively.
      const res = (await env.KB_INDEX.upsert(slice)) as unknown as { mutationId?: string };
      if (res?.mutationId) mutationId = res.mutationId;
      upserted += slice.length;
    }
  }

  // Purge orphans: ids written by a previous reindex that this one no longer
  // produced (a doc was shrunk/removed). Without this, deleted KB content stays
  // retrievable. Upsert-then-delete order keeps the index continuously served.
  const newIds = new Set(prepared.map((p) => p.id));
  let deletedOrphans = 0;
  if (env.CHAT_SESSIONS) {
    try {
      const prevRaw = await env.CHAT_SESSIONS.get(INDEX_IDS_KEY);
      const prevIds: string[] = prevRaw ? JSON.parse(prevRaw) : [];
      const orphans = prevIds.filter((id) => !newIds.has(id));
      for (let i = 0; i < orphans.length; i += UPSERT_BATCH) {
        await env.KB_INDEX.deleteByIds(orphans.slice(i, i + UPSERT_BATCH));
        deletedOrphans += Math.min(UPSERT_BATCH, orphans.length - i);
      }
    } catch {
      // First run (no prior state) or KV miss — nothing to purge.
    }
    await env.CHAT_SESSIONS.put(INDEX_IDS_KEY, JSON.stringify([...newIds]));
  }

  const docCount = (KB.en?.length || 0) + (KB.es?.length || 0);
  return { docs: docCount, chunks: prepared.length, upserted, deletedOrphans, mutationId, langs };
}

// ─── Retrieve ───────────────────────────────────────────────────────────────

// Embeds the question and returns the top-k KB chunks for the given language.
// Low-similarity matches are dropped so an off-topic question doesn't pad the
// prompt with irrelevant docs.
export async function retrieve(
  env: RagEnv,
  query: string,
  lang: Lang,
  topK = 6,
  minScore = 0.4,
): Promise<KbChunk[]> {
  const q = (query || '').slice(0, 1200).trim();
  if (!q) return [];
  const [vec] = await embed(env, [q]);
  // Over-fetch, then drop vectors whose doc is no longer in the bundle: an
  // index built before orphan tracking keeps ids the purge never learned about
  // (they answered with the retired Yammbo Flow and 404 slugs after the KB swap).
  const res = await env.KB_INDEX.query(vec, {
    topK: topK * 2,
    returnMetadata: 'all',
    filter: { lang },
  });
  const matches = res?.matches || [];
  const out: KbChunk[] = [];
  for (const m of matches) {
    if (typeof m.score === 'number' && m.score < minScore) continue;
    const md = (m.metadata || {}) as Record<string, string>;
    if (!md.text || !LIVE_SLUGS.has(md.slug || '')) continue;
    if (out.length >= topK) break;
    out.push({
      slug: md.slug || '',
      title: md.title || '',
      product: md.product || '',
      text: md.text,
      score: m.score,
    });
  }
  return out;
}
