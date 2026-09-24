#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as cheerio from 'cheerio';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFields = ['description', 'name', 'type', 'url', 'image_url'];
const argv = process.argv.slice(2);
const defaultImage = flagValue(argv, '--default-image');
const args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--default-image') {
    i += 1;
    continue;
  }
  args.push(argv[i]);
}

const workPath = args[1]
  ? path.resolve(process.cwd(), args[1])
  : path.join(skillDir, '.work', 'last-sample.json');
const sample = JSON.parse(await readFile(workPath, 'utf8'));
const extractorPath = args[0]
  ? path.resolve(process.cwd(), args[0])
  : sample.extractorPath;
const code = await readFile(extractorPath, 'utf8');

const seen = new Set();
const skippedUrls = [];
const uniquePages = [];
for (const page of sample.pages || []) {
  const key = normalizeUrl(page.url);
  if (seen.has(key)) {
    skippedUrls.push(page.url);
    continue;
  }
  seen.add(key);
  uniquePages.push(page);
}

const previews = uniquePages.map((page) => {
  try {
    const $ = cheerio.load(page.html);
    const sandbox = {
      $: $,
      request: { url: page.url },
      response: { body: $, url: page.url },
    };
    vm.createContext(sandbox);
    const script = new vm.Script(`${code}\nthis.__result = extract(request, response);`);
    script.runInContext(sandbox, { timeout: 3000 });
    const record = unwrap(sandbox.__result);
    return {
      url: page.url,
      result: sandbox.__result,
      coverage: scoreCoverage(record, page.analysis, defaultImage),
    };
  } catch (error) {
    return {
      url: page.url,
      error: error instanceof Error ? error.message : 'Extractor failed',
      coverage: {
        complete: false,
        missing: requiredFields,
        gaps: ['extractor_error'],
      },
    };
  }
});

const gapPages = previews.filter((preview) => !preview.coverage?.complete);

console.log(
  JSON.stringify(
    {
      sitemapFile: sample.sitemapFile,
      extractorPath,
      workPath,
      sampledUrls: sample.sampledUrls,
      skippedUrls: [...new Set([...(sample.skippedUrls || []), ...skippedUrls])],
      failures: sample.failures,
      completeCount: previews.length - gapPages.length,
      totalCount: previews.length,
      hasGaps: gapPages.length > 0,
      gapUrls: gapPages.map((preview) => preview.url),
      previews,
    },
    null,
    2
  )
);

function unwrap(result) {
  if (Array.isArray(result) && result[0] && typeof result[0] === 'object') return result[0];
  if (result && typeof result === 'object') return result;
  return {};
}

function scoreCoverage(record, analysis, fallbackImage) {
  const missing = requiredFields.filter((field) => {
    const value = record?.[field];
    return value == null || String(value).trim() === '';
  });
  const gaps = [...missing.map((field) => `missing:${field}`)];

  const bodyLen = Math.max(0, ...(analysis?.bodyCandidates || []).map((item) => item.textLength || 0));
  const description = String(record.description || '').replace(/\s+/g, ' ').trim();
  const name = String(record.name || '').replace(/\s+/g, ' ').trim();
  if (bodyLen >= 200 && description.length < 80) {
    gaps.push('thin_description');
  }
  if (bodyLen >= 200 && description && name && description === name) {
    gaps.push('description_is_title_only');
  }

  const image = String(record.image_url || '').trim();
  if (!image || (fallbackImage && image === fallbackImage)) {
    const pageHasImage = (analysis?.images || []).length > 0 || Boolean(analysis?.ogImage);
    if (pageHasImage && (!image || image === fallbackImage)) {
      gaps.push('missed_page_image');
    }
  }

  return {
    complete: gaps.length === 0,
    missing,
    gaps,
  };
}

function flagValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] || null;
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
