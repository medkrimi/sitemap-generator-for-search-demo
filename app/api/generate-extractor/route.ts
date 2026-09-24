import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, CursorAgentError } from '@cursor/sdk';

export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const EXTRACTOR_DIR = path.join(process.cwd(), 'public', 'generated_extractors');
const SAMPLE_WORK = path.join(
  process.cwd(),
  '.cursor/skills/generate-extractor/.work/last-sample.json'
);
const VALIDATE_WORK = path.join(
  process.cwd(),
  '.cursor/skills/generate-extractor/.work/last-validate.json'
);
const PREVIEW_SCRIPT = path.join(
  process.cwd(),
  '.cursor/skills/generate-extractor/scripts/preview-extractor.mjs'
);

const MAX_PASSES_LIMIT = 3;

export async function POST(request: NextRequest) {
  try {
    const { sitemapId, defaultImageUrl, maxPasses, refine } = await request.json();
    if (!sitemapId || typeof sitemapId !== 'string') {
      return NextResponse.json({ error: 'sitemapId is required' }, { status: 400 });
    }

    const passes = clampPasses(maxPasses);
    const isRefine = refine === true;

    const sitemapPath = path.join(process.cwd(), 'public', 'generated_sitemaps', `${sitemapId}.xml`);
    try {
      await fs.access(sitemapPath);
    } catch {
      return NextResponse.json({ error: 'Generated sitemap not found' }, { status: 404 });
    }

    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CURSOR_API_KEY is required to invoke the generate-extractor skill' },
        { status: 503 }
      );
    }

    const imageUrl =
      typeof defaultImageUrl === 'string' && defaultImageUrl.trim()
        ? defaultImageUrl.trim()
        : '';

    const result = await Agent.prompt(buildSkillPrompt(sitemapId, imageUrl, passes, isRefine), {
      apiKey,
      model: { id: 'composer-2.5' },
      local: {
        cwd: process.cwd(),
        settingSources: ['project'],
      },
    });

    if (result.status === 'error') {
      return NextResponse.json(
        {
          error: 'generate-extractor skill run failed',
          agentStatus: result.status,
          report: result.result,
        },
        { status: 502 }
      );
    }

    const extractorPath = path.join(EXTRACTOR_DIR, `${sitemapId}.js`);
    let extractorCode = '';
    try {
      extractorCode = await fs.readFile(extractorPath, 'utf-8');
    } catch {
      return NextResponse.json(
        {
          error: 'Skill finished but extractor file was not written',
          agentStatus: result.status,
          report: result.result,
        },
        { status: 502 }
      );
    }

    const training = await runPreview(extractorPath, SAMPLE_WORK, imageUrl);
    const validation = await runPreview(extractorPath, VALIDATE_WORK, imageUrl);
    const sampledUrls = asStringArray(training?.sampledUrls);
    const previews = asArray(training?.previews);

    return NextResponse.json({
      success: true,
      sitemapId,
      agentStatus: result.status,
      report: result.result,
      defaultImageUrl: imageUrl || null,
      maxPasses: passes,
      refined: isRefine,
      extractorPath: `public/generated_extractors/${sitemapId}.js`,
      extractorCode,
      sampledCount: sampledUrls.length,
      fetchedCount: previews.length,
      sampledUrls,
      failures: asArray(training?.failures),
      previews,
      validation: validation
        ? {
            sampledUrls: validation.sampledUrls ?? [],
            completeCount: validation.completeCount,
            totalCount: validation.totalCount,
            hasGaps: validation.hasGaps,
            gapUrls: validation.gapUrls ?? [],
            previews: validation.previews ?? [],
            failures: validation.failures ?? [],
          }
        : null,
    });
  } catch (error) {
    console.error('Error invoking generate-extractor skill:', error);
    if (error instanceof CursorAgentError) {
      return NextResponse.json(
        { error: `Skill did not start: ${error.message}`, retryable: error.isRetryable },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Failed to generate extractor' }, { status: 500 });
  }
}

function clampPasses(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(MAX_PASSES_LIMIT, Math.max(0, Math.round(parsed)));
}

function buildSkillPrompt(
  sitemapId: string,
  defaultImageUrl: string,
  maxPasses: number,
  refine: boolean
): string {
  const imageLine = defaultImageUrl
    ? `Default image URL (use this if no good universal image exists; do not ask again): ${defaultImageUrl}`
    : 'No default image URL was provided. If no good universal image exists, skip asking and use null as the image_url fallback.';

  const passLine =
    maxPasses === 0
      ? 'Do not regenerate after validation. Report remaining coverage gaps instead of looping.'
      : `Allowed regeneration passes after the current draft: ${maxPasses}. Stop once coverage is complete or the limit is reached.`;

  const startLine = refine
    ? `An extractor already exists at public/generated_extractors/${sitemapId}.js. Do not start over: run a fresh --validate batch on unused URLs, and if coverage has gaps run --expand and rewrite that same file.`
    : 'Start from step 1 and run the full workflow.';

  return [
    'Follow the project skill named generate-extractor.',
    '/generate-extractor',
    `Use this sitemap only: public/generated_sitemaps/${sitemapId}.xml`,
    `Pass --sitemap-id ${sitemapId} to sample-pages.mjs (including --validate).`,
    `Write the extractor to public/generated_extractors/${sitemapId}.js`,
    imageLine,
    startLine,
    passLine,
    'Do not wait for interactive confirmation. Complete sampling, extractor write, preview, validation, and regeneration if coverage has gaps.',
  ].join('\n');
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function runPreview(
  extractorPath: string,
  workPath: string,
  defaultImageUrl: string
): Promise<Record<string, unknown> | null> {
  try {
    await fs.access(workPath);
  } catch {
    return null;
  }

  const args = [PREVIEW_SCRIPT, extractorPath, workPath];
  if (defaultImageUrl) {
    args.push('--default-image', defaultImageUrl);
  }

  try {
    const { stdout } = await execFileAsync('node', args, {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    console.error('Extractor preview failed:', error);
    return null;
  }
}
