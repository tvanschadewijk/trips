import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REFERENCE_TEXT_CHARS,
  buildTripReferencePromptSection,
  formatFileSize,
  inferReferenceContentType,
  normalizeReferenceText,
  referenceFileIsAccepted,
  referenceFileIsImage,
} from './trip-references';

test('formats reference file metadata for the UI and prompt', () => {
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB');
  assert.equal(inferReferenceContentType('route.md'), 'text/markdown');
  assert.equal(inferReferenceContentType('booking.PDF'), 'application/pdf');
  assert.equal(inferReferenceContentType('archive.zip'), 'application/octet-stream');
  assert.equal(referenceFileIsAccepted('hotel.webp', ''), true);
  assert.equal(referenceFileIsAccepted('archive.zip', ''), false);
  assert.equal(referenceFileIsAccepted('archive.zip', 'application/zip'), false);
  assert.equal(referenceFileIsImage('image/webp'), true);
});

test('normalizes pasted JSON reference text when possible', () => {
  assert.equal(normalizeReferenceText('application/json', '{"city":"Tokyo"}'), '{\n  "city": "Tokyo"\n}');
  assert.equal(normalizeReferenceText('text/markdown', '# Tokyo'), '# Tokyo');
});

test('builds prompt section from pasted notes and uploaded references', () => {
  const section = buildTripReferencePromptSection('Use the Kyoto hotel as fixed.', [
    {
      id: 'ref-1',
      kind: 'file',
      file_name: 'booking.pdf',
      content_type: 'application/pdf',
      size: 2048,
      extracted_text: '- Hotel: Hotel Kanra Kyoto\n- Check-in: 2026-09-03',
      status: 'ready',
      error: '',
    },
    {
      id: 'ref-2',
      kind: 'photo',
      file_name: 'ticket.jpg',
      content_type: 'image/jpeg',
      size: 1024,
      extracted_text: '',
      status: 'partial',
      error: 'ANTHROPIC_API_KEY is not configured for file analysis.',
    },
  ]);

  assert.match(section, /Trip reference material/);
  assert.match(section, /Use the Kyoto hotel as fixed/);
  assert.match(section, /booking\.pdf/);
  assert.match(section, /Hotel Kanra Kyoto/);
  assert.match(section, /status: partial/);
  assert.match(section, /ANTHROPIC_API_KEY/);
});

test('truncates oversized pasted references before prompt insertion', () => {
  const oversized = 'A'.repeat(MAX_REFERENCE_TEXT_CHARS + 1000);
  const section = buildTripReferencePromptSection(oversized, []);

  assert.ok(section.length < MAX_REFERENCE_TEXT_CHARS + 400);
  assert.match(section, /Reference truncated/);
});
