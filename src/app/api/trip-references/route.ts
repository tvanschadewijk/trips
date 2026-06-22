import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  MAX_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_SOURCE_TEXT_CHARS,
  formatFileSize,
  inferReferenceContentType,
  normalizeReferenceText,
  referenceFileIsAccepted,
  referenceFileIsImage,
  truncateReferenceText,
  type TripReferenceSource,
} from '@/lib/trip-references';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_REFERENCE_MODEL = 'claude-haiku-4-5-20251001';

function cleanFileName(value: string): string {
  return value
    .replace(/[\\/]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 180) || 'Reference';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function extractTextFromPdfBytes(bytes: Uint8Array): string {
  const latin = new TextDecoder('windows-1252', { fatal: false }).decode(bytes);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const candidates: string[] = [];

  for (const source of [utf8, latin]) {
    const literalMatches = source.matchAll(/\(([^()]{4,300})\)\s*Tj/gu);
    for (const match of literalMatches) {
      candidates.push(match[1]);
    }
    const arrayMatches = source.matchAll(/\[((?:\s*\([^()]{1,220}\)\s*)+)\]\s*TJ/gu);
    for (const match of arrayMatches) {
      candidates.push(
        Array.from(match[1].matchAll(/\(([^()]{1,220})\)/gu))
          .map((part) => part[1])
          .join('')
      );
    }
  }

  const decoded = candidates
    .map((value) =>
      value
        .replace(/\\([nrtbf])/gu, ' ')
        .replace(/\\([()\\])/gu, '$1')
        .replace(/\\[0-7]{1,3}/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
    )
    .filter((value) => /[A-Za-z]{3}/u.test(value));

  return Array.from(new Set(decoded)).join('\n').trim();
}

async function extractWithAnthropic(file: File, contentType: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Automatic file analysis is not configured yet.');
  }

  const isImage = referenceFileIsImage(contentType);
  const sourceBlock = {
    type: isImage ? 'image' : 'document',
    source: {
      type: 'base64',
      media_type: contentType,
      data: arrayBufferToBase64(await file.arrayBuffer()),
    },
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: process.env.TRIP_REFERENCE_MODEL?.trim() || DEFAULT_REFERENCE_MODEL,
      max_tokens: 1600,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            sourceBlock,
            {
              type: 'text',
              text:
                'Extract travel-planning reference notes from this upload for an itinerary agent. Preserve explicit dates, destinations, traveler constraints, booked hotels/flights/restaurants/tickets, budget, route ideas, must-dos, and avoidances. If the upload is a screenshot or photo, transcribe visible useful text and summarize visible itinerary clues. Do not invent missing details. Return concise markdown bullets.',
            },
          ],
        },
      ],
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message ?? `Anthropic HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = Array.isArray(json?.content)
    ? json.content
        .filter((block: { type?: string; text?: string }) => block.type === 'text' && block.text)
        .map((block: { text: string }) => block.text)
        .join('\n')
    : '';

  if (!text.trim()) {
    throw new Error('No reference text was returned from the analysis model.');
  }

  return text;
}

async function extractReferenceText(file: File, contentType: string): Promise<{
  text: string;
  status: TripReferenceSource['status'];
  error: string;
}> {
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    file.name.toLowerCase().endsWith('.md') ||
    file.name.toLowerCase().endsWith('.markdown') ||
    file.name.toLowerCase().endsWith('.txt')
  ) {
    return {
      text: truncateReferenceText(
        normalizeReferenceText(contentType, await file.text()),
        MAX_REFERENCE_SOURCE_TEXT_CHARS
      ),
      status: 'ready',
      error: '',
    };
  }

  if (contentType === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const localText = extractTextFromPdfBytes(bytes);
    if (localText.length >= 120) {
      return {
        text: truncateReferenceText(localText, MAX_REFERENCE_SOURCE_TEXT_CHARS),
        status: 'ready',
        error: '',
      };
    }
  }

  try {
    return {
      text: truncateReferenceText(await extractWithAnthropic(file, contentType), MAX_REFERENCE_SOURCE_TEXT_CHARS),
      status: 'ready',
      error: '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not analyze this upload.';
    return {
      text: '',
      status: contentType === 'application/pdf' || referenceFileIsImage(contentType) ? 'partial' : 'unsupported',
      error: message,
    };
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const uploaded = form?.get('file');
  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: 'Upload a PDF, photo, text, or markdown file.' }, { status: 400 });
  }

  const fileName = cleanFileName(uploaded.name);
  const contentType = inferReferenceContentType(fileName, uploaded.type);
  if (!referenceFileIsAccepted(fileName, contentType)) {
    return NextResponse.json(
      { error: 'Upload a PDF, photo, text, markdown, or JSON file.' },
      { status: 400 }
    );
  }

  const maxBytes = referenceFileIsImage(contentType)
    ? MAX_REFERENCE_IMAGE_BYTES
    : MAX_REFERENCE_FILE_BYTES;
  if (uploaded.size > maxBytes) {
    return NextResponse.json(
      { error: `${fileName} must be smaller than ${formatFileSize(maxBytes)}.` },
      { status: 413 }
    );
  }

  const extracted = await extractReferenceText(uploaded, contentType);
  const source: TripReferenceSource = {
    id: crypto.randomUUID(),
    kind: referenceFileIsImage(contentType) ? 'photo' : 'file',
    file_name: fileName,
    content_type: contentType,
    size: uploaded.size,
    extracted_text: extracted.text,
    status: extracted.status,
    error: extracted.error,
  };

  return NextResponse.json({ source }, { status: 201 });
}
