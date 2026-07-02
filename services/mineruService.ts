
const MINERU_API_URL = (import.meta.env.VITE_MINERU_API_URL as string | undefined)?.replace(/\/$/, '');

export function isMinerUEnabled(): boolean {
  return Boolean(MINERU_API_URL?.trim());
}

/**
 * Upload a file to the self-hosted MinerU API server and return pre-extracted Markdown.
 * Returns null if MinerU is not configured, request times out, or the server returns no content.
 * The caller should fall back to direct Gemini image analysis on null.
 */
export async function convertToMarkdown(file: File): Promise<string | null> {
  if (!isMinerUEnabled()) return null;

  const formData = new FormData();
  formData.append('files', file, file.name);
  formData.append('return_md', 'true');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 min max

    const response = await fetch(`${MINERU_API_URL}/file_parse`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[MinerU] /file_parse returned HTTP ${response.status}`);
      return null;
    }

    const data: unknown = await response.json();
    const md = extractMarkdown(data);
    if (!md) {
      console.warn('[MinerU] Response contained no markdown content');
    }
    return md;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.warn('[MinerU] convertToMarkdown timed out (>120 s) — falling back to direct OCR');
    } else {
      console.warn('[MinerU] convertToMarkdown failed — falling back to direct OCR:', e);
    }
    return null;
  }
}

/** Handle multiple plausible response shapes from MinerU /file_parse. */
function extractMarkdown(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) return data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  // Root-level md_content
  if (typeof d.md_content === 'string' && d.md_content.trim()) return d.md_content;
  // Root-level markdown key
  if (typeof d.markdown === 'string' && d.markdown.trim()) return d.markdown;
  // Nested in result
  if (d.result && typeof d.result === 'object') {
    const r = d.result as Record<string, unknown>;
    if (typeof r.md_content === 'string' && r.md_content.trim()) return r.md_content;
  }
  // Array of file results
  if (Array.isArray(d.files) && d.files.length > 0) {
    const first = d.files[0] as Record<string, unknown>;
    if (first.result && typeof first.result === 'object') {
      const r = first.result as Record<string, unknown>;
      if (typeof r.md_content === 'string' && r.md_content.trim()) return r.md_content;
    }
    if (typeof first.md_content === 'string' && first.md_content.trim()) return first.md_content;
  }
  return null;
}
