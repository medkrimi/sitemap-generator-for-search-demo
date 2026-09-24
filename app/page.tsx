"use client";

import { useState } from "react";

interface ExtractorPreview {
  url: string;
  result?: unknown;
  error?: string;
}

interface FetchFailure {
  url: string;
  error: string;
}

interface ValidationPreview extends ExtractorPreview {
  coverage?: {
    complete: boolean;
    missing: string[];
    gaps: string[];
  };
}

interface ValidationResult {
  sampledUrls: string[];
  completeCount: number;
  totalCount: number;
  hasGaps: boolean;
  gapUrls: string[];
  previews: ValidationPreview[];
  failures: FetchFailure[];
}

export default function Home() {
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [subsetSize, setSubsetSize] = useState("100");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sitemapId, setSitemapId] = useState("");
  const [generatedSitemapUrl, setGeneratedSitemapUrl] = useState("");

  const [isBuildingExtractor, setIsBuildingExtractor] = useState(false);
  const [extractorError, setExtractorError] = useState("");
  const [extractorCode, setExtractorCode] = useState("");
  const [sampledUrls, setSampledUrls] = useState<string[]>([]);
  const [previews, setPreviews] = useState<ExtractorPreview[]>([]);
  const [failures, setFailures] = useState<FetchFailure[]>([]);
  const [copied, setCopied] = useState(false);
  const [defaultImageUrl, setDefaultImageUrl] = useState("");
  const [maxPasses, setMaxPasses] = useState("2");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isRefining, setIsRefining] = useState(false);

  const resetExtractor = () => {
    setExtractorError("");
    setExtractorCode("");
    setSampledUrls([]);
    setPreviews([]);
    setFailures([]);
    setValidation(null);
    setCopied(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setGeneratedSitemapUrl("");
    setSitemapId("");
    resetExtractor();

    try {
      const parsedSize = parseInt(subsetSize, 10);
      const size = Number.isFinite(parsedSize) && parsedSize >= 1 ? parsedSize : 100;

      const response = await fetch("/api/generate-subset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sitemapUrl, subsetSize: size }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate subset");
      }

      const data = await response.json();
      if (data.success && data.sitemapId) {
        setSitemapId(data.sitemapId);
        setGeneratedSitemapUrl(`/sitemap/${data.sitemapId}`);
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (error) {
      setError("An error occurred while generating the subset" + error);
    } finally {
      setIsLoading(false);
    }
  };

  const runExtractorSkill = async (refine: boolean) => {
    if (refine) {
      setIsRefining(true);
    } else {
      setIsBuildingExtractor(true);
    }
    setExtractorError("");
    setCopied(false);

    try {
      const response = await fetch("/api/generate-extractor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sitemapId,
          defaultImageUrl: defaultImageUrl.trim() || undefined,
          maxPasses: parseInt(maxPasses, 10),
          refine,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to generate extractor");
      }

      setSampledUrls(data.sampledUrls || []);
      setFailures(data.failures || []);
      setExtractorCode(data.extractorCode || "");
      setPreviews(data.previews || []);
      setValidation(data.validation || null);
    } catch (error) {
      setExtractorError(
        error instanceof Error ? error.message : "Failed to generate extractor"
      );
    } finally {
      setIsBuildingExtractor(false);
      setIsRefining(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extractorCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Sitemap Subset Generator</h1>
      <p className="mb-8 text-center text-gray-600 dark:text-gray-400 max-w-2xl">
        Easily generate smaller, manageable sitemaps from large XML files. Input
        your sitemap URL, set a subset size for each content category, and let
        the tool select the required number of URLs for indexing—perfect for
        search sandboxes with URL limits.
      </p>
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <div>
          <label
            htmlFor="sitemapUrl"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Sitemap URL
          </label>
          <input
            type="url"
            id="sitemapUrl"
            value={sitemapUrl}
            onChange={(e) => setSitemapUrl(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            placeholder="https://example.com/sitemap.xml"
          />
        </div>
        <div>
          <label
            htmlFor="subsetSize"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Subset Size
          </label>
          <input
            type="number"
            id="subsetSize"
            value={subsetSize}
            onChange={(e) => setSubsetSize(e.target.value)}
            min="1"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            placeholder="100"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {isLoading ? "Generating..." : "Generate Subset"}
        </button>
      </form>
      {error && <p className="mt-4 text-red-500">{error}</p>}
      {generatedSitemapUrl && (
        <div className="mt-8 w-full max-w-4xl space-y-6">
          <div>
            <p className="text-lg font-semibold">Generated Sitemap:</p>
            <a
              href={generatedSitemapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {`${window.location.origin}${generatedSitemapUrl}`}
            </a>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4">
            <h2 className="text-xl font-semibold">Step 2: Debug extractor</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Runs the project skill <code>generate-extractor</code>: sample 10
              URLs, assemble a Cheerio extractor, then validate on 10 more pages.
            </p>
            <div>
              <label
                htmlFor="defaultImageUrl"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Default image URL (used if no page image is found)
              </label>
              <input
                type="url"
                id="defaultImageUrl"
                value={defaultImageUrl}
                onChange={(e) => setDefaultImageUrl(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                placeholder="https://example.com/default.jpg"
              />
            </div>
            <div>
              <label
                htmlFor="maxPasses"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Refinement passes after the first draft
              </label>
              <select
                id="maxPasses"
                value={maxPasses}
                onChange={(e) => setMaxPasses(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
              >
                <option value="0">0 — validate only, report gaps</option>
                <option value="1">1 pass</option>
                <option value="2">2 passes (default)</option>
                <option value="3">3 passes</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => runExtractorSkill(false)}
                disabled={isBuildingExtractor || isRefining}
                className="flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-60"
              >
                {isBuildingExtractor
                  ? "Running generate-extractor skill..."
                  : "Assemble extractor from 10 random URLs"}
              </button>
              {extractorCode && (
                <button
                  type="button"
                  onClick={() => runExtractorSkill(true)}
                  disabled={isBuildingExtractor || isRefining}
                  className="flex justify-center py-2 px-4 border border-indigo-600 rounded-md shadow-sm text-sm font-medium text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-60"
                >
                  {isRefining
                    ? "Validating and refining..."
                    : "Validate on 10 more URLs and refine"}
                </button>
              )}
            </div>
            {extractorError && (
              <p className="text-red-500">{extractorError}</p>
            )}
          </div>

          {sampledUrls.length > 0 && (
            <div>
              <p className="font-semibold mb-2">Sampled URLs</p>
              <ul className="list-disc pl-5 space-y-1 text-sm break-all">
                {sampledUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {failures.length > 0 && (
            <div>
              <p className="font-semibold mb-2">Fetch failures</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-red-600 dark:text-red-400 break-all">
                {failures.map((failure) => (
                  <li key={failure.url}>
                    {failure.url}: {failure.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {extractorCode && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold">Generated extractor</p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-sm text-indigo-600 hover:underline"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-auto max-h-96 rounded-md bg-gray-900 text-gray-100 p-4 text-xs">
                <code>{extractorCode}</code>
              </pre>
            </div>
          )}

          {previews.length > 0 && (
            <div>
              <p className="font-semibold mb-2">Extraction preview</p>
              <div className="space-y-3">
                {previews.map((preview) => (
                  <div
                    key={preview.url}
                    className="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm"
                  >
                    <p className="font-medium break-all mb-2">{preview.url}</p>
                    {preview.error ? (
                      <p className="text-red-600 dark:text-red-400">
                        {preview.error}
                      </p>
                    ) : (
                      <pre className="overflow-auto max-h-48 rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-3 text-xs">
                        {JSON.stringify(preview.result, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {validation && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold">Validation on unused URLs</p>
                <span
                  className={
                    validation.hasGaps
                      ? "text-sm text-amber-600 dark:text-amber-400"
                      : "text-sm text-green-600 dark:text-green-400"
                  }
                >
                  {validation.completeCount}/{validation.totalCount} complete
                </span>
              </div>
              {validation.hasGaps ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Coverage gaps remain. Run another refinement pass to feed these
                  URLs back into extractor generation.
                </p>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Every validation page returned all five fields.
                </p>
              )}
              <div className="space-y-3">
                {validation.previews.map((preview) => (
                  <div
                    key={preview.url}
                    className="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm"
                  >
                    <p className="font-medium break-all mb-2">{preview.url}</p>
                    {preview.coverage && !preview.coverage.complete && (
                      <p className="text-amber-600 dark:text-amber-400 mb-2">
                        {preview.coverage.gaps.join(", ")}
                      </p>
                    )}
                    {preview.error ? (
                      <p className="text-red-600 dark:text-red-400">
                        {preview.error}
                      </p>
                    ) : (
                      <pre className="overflow-auto max-h-48 rounded bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-3 text-xs">
                        {JSON.stringify(preview.result, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
