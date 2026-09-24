import { XMLParser } from 'fast-xml-parser';

interface SitemapUrl {
  loc: string;
  [key: string]: string | undefined;
}

export function parseSitemapUrls(xmlData: string, baseUrl: string): string[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const result = parser.parse(xmlData);
  const raw = result.urlset?.url;
  const entries: Array<SitemapUrl | string> = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return entries
    .map((url) => toAbsoluteUrl(typeof url === 'string' ? url : url.loc, baseUrl))
    .filter((url): url is string => url !== null);
}

function toAbsoluteUrl(loc: unknown, baseUrl: string): string | null {
  const raw = typeof loc === 'string' ? loc.trim() : String(loc ?? '').trim();
  if (!raw) return null;

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}
