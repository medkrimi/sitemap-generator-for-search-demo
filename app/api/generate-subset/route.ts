import { NextRequest, NextResponse } from 'next/server';
import { XMLBuilder } from 'fast-xml-parser';
import { promises as fs } from 'fs';
import path from 'path';
import { parseSitemapUrls } from '@/lib/sitemap';

const SITEMAP_DIR = path.join(process.cwd(), 'public', 'generated_sitemaps');

function determineContentType(url: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  const contentTypeIndicators = ['locations', 'doctors', 'conditions-and-treatments', 'forms', 'about'];

  for (const part of pathParts) {
    const lowercasePart = part.toLowerCase();
    if (contentTypeIndicators.includes(lowercasePart)) {
      return lowercasePart;
    }
    if (lowercasePart.endsWith('s') && contentTypeIndicators.includes(lowercasePart.slice(0, -1))) {
      return lowercasePart;
    }
  }

  return pathParts[0] || 'other';
}

export async function POST(request: NextRequest) {
  try {
    const { sitemapUrl, subsetSize } = await request.json();

    const response = await fetch(sitemapUrl);
    const xmlData = await response.text();
    const baseUrl = response.url || sitemapUrl;
    const urls = parseSitemapUrls(xmlData, baseUrl);

    if (urls.length === 0) {
      throw new Error('Sitemap contained no usable URLs');
    }

    const groupedUrls: { [key: string]: string[] } = {};
    urls.forEach((url: string) => {
      const contentType = determineContentType(url);
      if (!groupedUrls[contentType]) {
        groupedUrls[contentType] = [];
      }
      groupedUrls[contentType].push(url);
    });

    const subsetUrls: string[] = [];
    Object.entries(groupedUrls).forEach(([contentType, groupUrls]) => {
      const groupSubset = groupUrls.slice(0, subsetSize);
      subsetUrls.push(...groupSubset);
      console.log(`Content type: ${contentType}, Total URLs: ${groupUrls.length}, Subset size: ${groupSubset.length}`);
    });

    const builder = new XMLBuilder({
      arrayNodeName: "url",
      format: true,
      ignoreAttributes: false,
      suppressEmptyNode: true
    });
    const newSitemap = builder.build({
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      urlset: {
        '@_xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9',
        url: subsetUrls.map(url => ({ loc: url }))
      }
    });

    const sitemapId = Date.now().toString();
    await fs.mkdir(SITEMAP_DIR, { recursive: true });
    const filePath = path.join(SITEMAP_DIR, `${sitemapId}.xml`);
    await fs.writeFile(filePath, newSitemap);

    return NextResponse.json({
      success: true,
      sitemapId,
      totalUrls: urls.length,
      subsetSize: subsetUrls.length
    });
  } catch (error) {
    console.error('Error processing sitemap:', error);
    return NextResponse.json({ error: 'Failed to process sitemap' }, { status: 500 });
  }
}
