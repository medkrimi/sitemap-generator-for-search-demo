#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = await findRepoRoot(skillDir);
const sitemapDir = path.join(repoRoot, 'public', 'generated_sitemaps');
const workDir = path.join(skillDir, '.work');
const samplePath = path.join(workDir, 'last-sample.json');
const validatePath = path.join(workDir, 'last-validate.json');
const reviewedPath = path.join(workDir, 'reviewed.json');
const sampleSize = 10;
const { mode, sitemapId: sitemapIdArg } = parseArgs(process.argv.slice(2));

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  responseType: 'text',
  validateStatus: (status) => status >= 200 && status < 400,
  headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

await mkdir(workDir, { recursive: true });

if (mode === 'expand') {
  const sample = JSON.parse(await readFile(samplePath, 'utf8'));
  const extra = JSON.parse(await readFile(validatePath, 'utf8'));
  const seen = new Set((sample.pages || []).map((page) => normalizeUrl(page.url)));
  const skippedUrls = [];
  for (const page of extra.pages || []) {
    const key = normalizeUrl(page.url);
    if (seen.has(key)) {
      skippedUrls.push(page.url);
      continue;
    }
    sample.pages.push(page);
    seen.add(key);
  }
  sample.sampledUrls = [...new Set([...(sample.sampledUrls || []), ...(extra.sampledUrls || [])])];
  sample.failures = [...(sample.failures || []), ...(extra.failures || [])];
  sample.usedUrls = [...new Set([...(sample.usedUrls || sample.sampledUrls || []), ...(extra.sampledUrls || [])])];
  sample.skippedUrls = skippedUrls;
  await saveReviewed(sample.sitemapId, [
    ...(sample.pages || []).map((page) => page.url),
    ...(extra.sampledUrls || []),
  ]);
  await writeFile(samplePath, JSON.stringify(sample));
  printSummary(samplePath, sample);
  process.exit(0);
}

const latest = sitemapIdArg
  ? await sitemapById(sitemapDir, sitemapIdArg)
  : await latestSitemap(sitemapDir);
if (!latest) {
  console.error(
    sitemapIdArg
      ? `Sitemap ${sitemapIdArg}.xml not found in ${sitemapDir}`
      : `No sitemap.xml files found in ${sitemapDir}`
  );
  process.exit(1);
}

const xml = await readFile(latest.path, 'utf8');
const urls = parseSitemapUrls(xml, latest.baseUrl);
if (urls.length === 0) {
  console.error(`Sitemap ${latest.fileName} contained no usable URLs`);
  process.exit(1);
}

const previouslyReviewed = await loadReviewed(latest.id);
if (mode === 'validate') {
  try {
    const sample = JSON.parse(await readFile(samplePath, 'utf8'));
    for (const url of sample.usedUrls || sample.sampledUrls || []) {
      previouslyReviewed.add(normalizeUrl(url));
    }
  } catch {
    console.error('Run sample-pages.mjs without --validate before validating');
    process.exit(1);
  }
}

const pool = urls.filter((url) => !previouslyReviewed.has(normalizeUrl(url)));
if (pool.length === 0) {
  console.error('No remaining unreviewed URLs in the sitemap to sample');
  process.exit(1);
}

const sampled = sampleUrls(pool, sampleSize);
const htmlCache = await loadHtmlCache();
const { pages, failures, skippedUrls } = await fetchPages(sampled, htmlCache);

if (pages.length === 0) {
  console.error('Could not fetch HTML from any sampled URL');
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

const payload = {
  repoRoot,
  sitemapFile: latest.fileName,
  sitemapId: latest.id,
  extractorPath: path.join(repoRoot, 'public', 'generated_extractors', `${latest.id}.js`),
  origin: new URL(pages[0].url).origin,
  allUrls: urls,
  usedUrls: [...new Set([...previouslyReviewed, ...sampled.map(normalizeUrl)])],
  sampledUrls: sampled,
  skippedUrls,
  failures,
  pages: pages.map((page) => ({
    url: page.url,
    html: page.html,
    analysis: page.analysis || analyzePage(page.url, page.html),
  })),
};

const workPath = mode === 'validate' ? validatePath : samplePath;
await saveReviewed(latest.id, pages.map((page) => page.url));
await writeFile(workPath, JSON.stringify(payload));
printSummary(workPath, payload);

function parseArgs(args) {
  let mode = 'sample';
  let sitemapId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expand') mode = 'expand';
    else if (args[i] === '--validate') mode = 'validate';
    else if (args[i] === '--sitemap-id') sitemapId = args[++i] || null;
  }
  return { mode, sitemapId };
}

function printSummary(workPath, payload) {
  console.log(
    JSON.stringify(
      {
        workPath,
        sitemapFile: payload.sitemapFile,
        sitemapId: payload.sitemapId,
        extractorPath: payload.extractorPath,
        origin: payload.origin,
        sampledUrls: payload.sampledUrls,
        skippedUrls: payload.skippedUrls || [],
        failures: payload.failures,
        pageCount: payload.pages?.length || 0,
        pages: (payload.pages || []).map((page) => ({
          url: page.url,
          analysis: page.analysis,
        })),
      },
      null,
      2
    )
  );
}

async function fetchPages(sampled, htmlCache) {
  const pages = [];
  const failures = [];
  const skippedUrls = [];
  const toFetch = [];

  for (const url of sampled) {
    const cached = htmlCache.get(normalizeUrl(url));
    if (cached?.html) {
      skippedUrls.push(url);
      pages.push({
        url: cached.url || url,
        html: cached.html,
        analysis: cached.analysis || analyzePage(cached.url || url, cached.html),
      });
    } else {
      toFetch.push(url);
    }
  }

  const batchSize = 5;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchPage));
    for (const result of results) {
      if (result.html) pages.push(result);
      else failures.push({ url: result.url, error: result.error });
    }
  }

  return { pages, failures, skippedUrls };
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return String(url || '').trim();
  }
}

async function loadReviewed(sitemapId) {
  try {
    const data = JSON.parse(await readFile(reviewedPath, 'utf8'));
    return new Set((data[sitemapId] || []).map(normalizeUrl));
  } catch {
    return new Set();
  }
}

async function saveReviewed(sitemapId, urls) {
  if (!sitemapId) return;
  let data = {};
  try {
    data = JSON.parse(await readFile(reviewedPath, 'utf8'));
  } catch {
    data = {};
  }
  const next = new Set([...(data[sitemapId] || []).map(normalizeUrl), ...urls.map(normalizeUrl)]);
  data[sitemapId] = [...next];
  await writeFile(reviewedPath, JSON.stringify(data, null, 2));
}

async function loadHtmlCache() {
  const cache = new Map();
  for (const filePath of [samplePath, validatePath]) {
    try {
      const payload = JSON.parse(await readFile(filePath, 'utf8'));
      for (const page of payload.pages || []) {
        if (!page?.url || !page.html) continue;
        cache.set(normalizeUrl(page.url), page);
      }
    } catch {
      // missing cache is fine
    }
  }
  return cache;
}

async function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    try {
      await stat(path.join(dir, 'package.json'));
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error('Could not find repo root (package.json)');
}

async function sitemapById(dir, id) {
  const fileName = `${id}.xml`;
  const filePath = path.join(dir, fileName);
  try {
    await stat(filePath);
  } catch {
    return null;
  }
  return {
    path: filePath,
    fileName,
    id,
    idNum: Number(id) || 0,
    mtimeMs: 0,
    baseUrl: 'https://example.com/',
  };
}

async function latestSitemap(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const xmlFiles = files.filter((name) => name.endsWith('.xml'));
  let newest = null;

  for (const fileName of xmlFiles) {
    const filePath = path.join(dir, fileName);
    const info = await stat(filePath);
    const id = fileName.replace(/\.xml$/i, '');
    const idNum = Number(id);
    const candidate = {
      path: filePath,
      fileName,
      id,
      idNum: Number.isFinite(idNum) ? idNum : 0,
      mtimeMs: info.mtimeMs,
      baseUrl: 'https://example.com/',
    };
    if (
      !newest ||
      candidate.idNum > newest.idNum ||
      (candidate.idNum === newest.idNum && candidate.mtimeMs > newest.mtimeMs)
    ) {
      newest = candidate;
    }
  }

  return newest;
}

function parseSitemapUrls(xmlData, baseUrl) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const result = parser.parse(xmlData);
  const raw = result.urlset?.url;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return entries
    .map((entry) => {
      const loc = typeof entry === 'string' ? entry : entry?.loc;
      const value = typeof loc === 'string' ? loc.trim() : '';
      if (!value) return null;
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function sampleUrls(urls, count) {
  const unique = [...new Set(urls)];
  const copy = [...unique];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

async function fetchPage(url) {
  try {
    const response = await http.get(url);
    const html = typeof response.data === 'string' ? response.data : String(response.data);
    if (!html.trim()) return { url, error: 'Empty response body' };
    const finalUrl = response.request?.res?.responseUrl || url;
    return { url: finalUrl, html };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unknown fetch error';
    return { url, error: message };
  }
}

function analyzePage(pageUrl, html) {
  const $ = cheerio.load(html);
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = '';
  }

  const pathParts = (() => {
    try {
      return new URL(pageUrl).pathname.split('/').filter(Boolean);
    } catch {
      return [];
    }
  })();

  return {
    origin,
    pathFirstSegment: pathParts[0] || null,
    title: $('title').first().text().trim() || null,
    ogTitle: attr($, 'meta[property="og:title"]', 'content'),
    ogDescription: attr($, 'meta[property="og:description"]', 'content'),
    ogType: attr($, 'meta[property="og:type"]', 'content'),
    ogUrl: attr($, 'meta[property="og:url"]', 'content'),
    ogImage: attr($, 'meta[property="og:image"]', 'content'),
    metaTitle: attr($, 'meta[name="title"]', 'content') || attr($, 'meta[name="searchtitle"]', 'content'),
    metaDescription: attr($, 'meta[name="description"]', 'content'),
    canonical: attr($, 'link[rel="canonical"]', 'href'),
    h1: collect($, 'h1', 5).map((el) => ({
      selector: distinctiveSelector($, el),
      text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 180),
    })),
    bodyCandidates: collect($, 'main, article, [class*="content"], [class*="body"], .main, p', 12)
      .map((el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        return {
          selector: distinctiveSelector($, el),
          tag: el.tagName?.toLowerCase() || null,
          textLength: text.length,
          preview: text.slice(0, 280),
        };
      })
      .filter((item) => item.selector && item.textLength >= 40)
      .sort((a, b) => b.textLength - a.textLength)
      .slice(0, 8),
    images: collect($, 'main img, article img, .hero img, img', 12)
      .map((el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        return {
          selector: distinctiveSelector($, el),
          src,
        };
      })
      .filter((item) => item.src && !item.src.startsWith('data:') && !/logo|icon|sprite|favicon|pixel|spacer/i.test(item.src)),
  };
}

function attr($, selector, name) {
  const value = $(selector).first().attr(name);
  return value ? String(value).trim() : null;
}

function collect($, selector, limit) {
  const nodes = [];
  $(selector).each((_, el) => {
    if (nodes.length < limit) nodes.push(el);
  });
  return nodes;
}

function distinctiveSelector($, el, maxDepth = 4) {
  const parts = [];
  let current = el;
  for (let i = 0; i < maxDepth && current; i++) {
    const tag = current.tagName?.toLowerCase();
    if (!tag || tag === 'html' || tag === 'body') break;
    const id = $(current).attr('id');
    if (id && !/^\d+$/.test(id) && !/\d{4,}/.test(id)) {
      parts.unshift(`#${cssEscape(id)}`);
      break;
    }
    const classes = String($(current).attr('class') || '')
      .split(/\s+/)
      .filter((cls) => cls && cls.length < 48 && !/^(sm:|md:|lg:|xl:|w-|h-|p-|m-|flex|grid|text-|bg-|border)/.test(cls))
      .slice(0, 2);
    parts.unshift(classes.length ? `${tag}.${classes.map(cssEscape).join('.')}` : tag);
    const parent = current.parent;
    current = parent && 'tagName' in parent ? parent : null;
  }
  return parts.length ? parts.join(' ') : null;
}

function cssEscape(value) {
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
