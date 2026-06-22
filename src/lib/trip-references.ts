import { z } from 'zod';

export const MAX_REFERENCE_TEXT_CHARS = 18_000;
export const MAX_REFERENCE_SOURCE_TEXT_CHARS = 12_000;
export const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCE_SOURCES = 8;

export const ACCEPTED_REFERENCE_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const ACCEPTED_REFERENCE_FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  ...ACCEPTED_REFERENCE_IMAGE_TYPES,
] as const;

export const TripReferenceSourceSchema = z
  .object({
    id: z.string().trim().max(100),
    kind: z.enum(['file', 'photo', 'paste']).default('file'),
    file_name: z.string().trim().max(180).default('Reference'),
    content_type: z.string().trim().max(120).default('application/octet-stream'),
    size: z.number().int().min(0).max(MAX_REFERENCE_FILE_BYTES).default(0),
    extracted_text: z.string().trim().max(MAX_REFERENCE_SOURCE_TEXT_CHARS).default(''),
    status: z.enum(['ready', 'partial', 'unsupported', 'error']).default('ready'),
    error: z.string().trim().max(500).default(''),
  })
  .strict();

export const TripReferenceSourceListSchema = z
  .array(TripReferenceSourceSchema)
  .max(MAX_REFERENCE_SOURCES)
  .default([]);

export type TripReferenceSource = z.infer<typeof TripReferenceSourceSchema>;

export function truncateReferenceText(value: string, max = MAX_REFERENCE_TEXT_CHARS): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 80).trimEnd()}\n\n[Reference truncated to ${max} characters.]`;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function inferReferenceContentType(fileName: string, contentType = ''): string {
  const lowerName = fileName.toLowerCase();
  const normalizedContentType = contentType.trim().toLowerCase();
  if (normalizedContentType && normalizedContentType !== 'application/octet-stream') {
    return normalizedContentType;
  }
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'text/markdown';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.json')) return 'application/json';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.heic')) return 'image/heic';
  if (lowerName.endsWith('.heif')) return 'image/heif';
  return 'application/octet-stream';
}

export function referenceFileIsAccepted(fileName: string, contentType: string): boolean {
  const normalizedType = inferReferenceContentType(fileName, contentType);
  const lowerName = fileName.toLowerCase();
  return (
    (ACCEPTED_REFERENCE_FILE_TYPES as readonly string[]).includes(normalizedType) ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.pdf')
  );
}

export function referenceFileIsImage(contentType: string): boolean {
  return (ACCEPTED_REFERENCE_IMAGE_TYPES as readonly string[]).includes(contentType);
}

export function normalizeReferenceText(contentType: string, text: string): string {
  if (contentType === 'application/json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

export function buildTripReferencePromptSection(
  referenceText: string,
  sources: TripReferenceSource[]
): string {
  const pasted = truncateReferenceText(referenceText, MAX_REFERENCE_TEXT_CHARS);
  const readySources = sources.filter(
    (source) => source.extracted_text.trim() || source.status !== 'ready'
  );

  if (!pasted && readySources.length === 0) return '';

  const lines = [
    'Trip reference material:',
    'Use this as user-provided context. Preserve explicit dates, bookings, constraints, and place names. Treat extraction notes as imperfect evidence and do not invent details that are not present.',
  ];

  if (pasted) {
    lines.push('', '## Pasted notes or markdown', pasted);
  }

  if (readySources.length) {
    lines.push('', '## Uploaded references');
    readySources.forEach((source, index) => {
      const label = source.file_name || `Reference ${index + 1}`;
      const meta = [
        source.content_type,
        source.size ? formatFileSize(source.size) : null,
        source.status !== 'ready' ? `status: ${source.status}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push('', `### ${label}${meta ? ` (${meta})` : ''}`);
      if (source.extracted_text.trim()) {
        lines.push(truncateReferenceText(source.extracted_text, MAX_REFERENCE_SOURCE_TEXT_CHARS));
      } else {
        lines.push(source.error || 'No text could be extracted from this upload.');
      }
    });
  }

  return `${lines.join('\n')}\n`;
}
