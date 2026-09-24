---
name: generate-extractor
description: Generates a Cheerio production extractor from the most recently created sitemap in public/generated_sitemaps. Samples 10 URLs, fetches HTML, asks for a default image URL when no universal image is found, writes extract() returning description, name, type, url, and image_url, then validates against 10 more random sitemap URLs and regenerates if coverage has gaps. Use when the user asks to generate an extractor, create a custom extractor from a sitemap, replicate extractors/sample.js, or assemble Cheerio targeting for sitemap pages.
---

# Generate Cheerio extractor

Build one production-style `extract(request, response)` function from the newest sitemap in `public/generated_sitemaps/`, using [template.js](template.js) (same shape as `app/extractors/sample.js`).

## Required response fields

Return a JSON object with description, name, type, url, and image_url for the page.

- Description should be as much of the body copy text as possible from the page.
- Name should be the title of the page, either the og:title, meta title, or `<title>` tag contents.
- Type should be a category designation from the og:type metadata, or otherwise use the first directory (if present) in the URL for the page.
- URL should be the canonical URL of the page.
- Image_url should be a unique image for the page, hopefully as og:image, otherwise the first image found in the page body.

Use Cheerio-compatible targeting. Production injects Cheerio as `response.body`.

## Workflow

```
Task Progress:
- [ ] Sample 10 URLs and fetch HTML
- [ ] Ask for a default image URL if no good universal image exists
- [ ] Choose one Cheerio selector set that works across the sample
- [ ] Write extractor from template.js
- [ ] Save to public/generated_extractors/
- [ ] Preview JSON for the training URLs
- [ ] Validate against 10 more random sitemap URLs
- [ ] If coverage has gaps, merge those URLs and repeat generation
- [ ] Report to the user
```

### 1. Sample pages

From the repo root:

```bash
node .cursor/skills/generate-extractor/scripts/sample-pages.mjs
# or, when a caller names a sitemap:
node .cursor/skills/generate-extractor/scripts/sample-pages.mjs --sitemap-id <id>
```

This finds the most recently created `*.xml` in `public/generated_sitemaps/` (or `--sitemap-id <id>` when the caller names a sitemap), selects 10 different URLs (or all if fewer), fetches HTML, writes cache to `.cursor/skills/generate-extractor/.work/last-sample.json`, and prints analysis JSON (no HTML) on stdout.

If it exits non-zero, stop and tell the user. Do not invent URLs.

### Skip already-reviewed URLs

Do not fetch, re-analyze, or re-preview a URL that this skill already reviewed for the same sitemap.

Reviewed URLs are stored in `.cursor/skills/generate-extractor/.work/reviewed.json` (keyed by sitemap id) and also appear as `usedUrls` / `skippedUrls` in script stdout. Treat trailing-slash variants of the same URL as the same page.

- `sample-pages.mjs` (sample and `--validate`) draws only from unreviewed URLs. If stdout lists `skippedUrls`, those were served from HTML cache — do not treat them as a new review.
- `--expand` skips validation pages whose URL is already in the training set.
- `preview-extractor.mjs` skips duplicate URLs in the same work file.
- When choosing selectors, spend attention on **new** pages this pass. Do not re-derive targeting from an already-reviewed URL unless `--expand` just added it as a new training page.
- After rewriting the extractor, you may re-run extract() on the combined training set (that tests the new code). Do not re-fetch those pages.

If there are no remaining unreviewed URLs, stop and report that instead of resampling the same list.

### 2. Default image

If the sample has no good universal image to use (no shared `og:image`, and no single non-logo body/hero image selector that works across the sample), ask the user for a URL to a default image to use. Do not invent a fallback image URL.

Put that URL in `addBaseURL` origin handling as needed, and as the final `image_url` fallback in the extractor:

```js
'image_url': image_url || $('meta[property="og:image"]').attr('content') || 'https://example.com/default.jpg'
```

If a good universal image already exists, use it and skip asking.

### 3. Choose selectors

Read stdout analysis plus [template.js](template.js). Pick selectors that work on as many of the sampled pages as possible, not a different extractor per URL.

| Field | Prefer | Then |
| --- | --- | --- |
| `description` | Shared main/body-copy container; `concatText(...)` | `og:description`, `meta[name=description]` |
| `name` | `meta[property="og:title"]` | `meta[name="title"]` / `searchtitle`, then `$('title')` |
| `type` | `meta[property="og:type"]` | first URL directory via regex; run `titleCased` |
| `url` | `link[rel="canonical"]` (or `og:url` if that is the canonical) | `response.url` |
| `image_url` | `meta[property="og:image"]` | first non-logo body `img` `src`/`data-src`; `addBaseURL` for relative paths; then the user default image URL |

Do not use logos, icons, sprites, favicons, tracking pixels. Prefer page-specific hero/content images.

Keep `$ = response.body`. Return `[{ ... }]` (array with one object), same as the template.

Keep helpers `titleCased`, `addBaseURL` (site origin from the sample), and `concatText`.

### 4. Save extractor

Write the file to `extractorPath` from the sample script (same basename as the sitemap, `.js`):

`public/generated_extractors/<sitemap-basename>.js`

Create `public/generated_extractors/` if needed.

### 5. Preview training URLs

```bash
node .cursor/skills/generate-extractor/scripts/preview-extractor.mjs --default-image "https://example.com/default.jpg"
```

Pass `--default-image` only when the user provided one. If previews fail, fix selectors and re-run. Do not hand-write preview JSON.

### 6. Validate on 10 more random URLs

Select 10 more **unreviewed** random URLs from the sitemap and compare results for completeness and coverage:

```bash
node .cursor/skills/generate-extractor/scripts/sample-pages.mjs --validate --sitemap-id <id>
node .cursor/skills/generate-extractor/scripts/preview-extractor.mjs public/generated_extractors/<id>.js .cursor/skills/generate-extractor/.work/last-validate.json --default-image "https://example.com/default.jpg"
```

A page has a coverage gap when `coverage.complete` is false. Typical `gaps` values: `missing:description`, `missing:name`, `missing:type`, `missing:url`, `missing:image_url`, `thin_description`, `description_is_title_only`, `missed_page_image`, `extractor_error`.

Title-only description is not a gap when the page HTML has no real body copy.

### 7. Repeat generation if there are gaps

If there are gaps in coverage, take these 10 additional URLs and repeat the extractor generation process:

```bash
node .cursor/skills/generate-extractor/scripts/sample-pages.mjs --expand
```

Then rewrite the extractor using the combined sample (original 10 plus the 10 additional URLs), save over the same `extractorPath`, preview the combined training set, and run `--validate` again on a new unused batch.

Repeat at most twice after the first draft (three extractor writes total), or however many passes the caller specified. If gaps remain, keep the latest extractor and report remaining gap URLs and `gaps` instead of looping further.

### 8. User report

Reply with:

1. Sitemap file used
2. Saved extractor path
3. Default image URL used, or note that a universal page image was found
4. The 10 training URLs selected
5. Fetch failures, if any, and URLs skipped because they were already reviewed
6. For each **new** training URL, the preview JSON object from the created extractor (the object inside the returned array)
7. The 10 validation URLs, completeness (`completeCount` / `totalCount`), and any remaining gaps

Do not dump full page HTML in the report.
