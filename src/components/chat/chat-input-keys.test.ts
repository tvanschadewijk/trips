import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSubmitChatMessageKey } from './chat-input-keys';

function keyEvent(
  overrides: Partial<Parameters<typeof shouldSubmitChatMessageKey>[0]> = {}
): Parameters<typeof shouldSubmitChatMessageKey>[0] {
  return {
    key: 'Enter',
    code: 'Enter',
    shiftKey: false,
    nativeEvent: { isComposing: false },
    ...overrides,
  };
}

test('plain Enter submits the chat message', () => {
  assert.equal(shouldSubmitChatMessageKey(keyEvent()), true);
});

test('numpad Enter submits the chat message', () => {
  assert.equal(
    shouldSubmitChatMessageKey(keyEvent({ key: 'Enter', code: 'NumpadEnter' })),
    true
  );
});

test('Shift+Enter keeps multiline input available', () => {
  assert.equal(shouldSubmitChatMessageKey(keyEvent({ shiftKey: true })), false);
});

test('IME composition Enter does not submit early', () => {
  assert.equal(
    shouldSubmitChatMessageKey(keyEvent({ nativeEvent: { isComposing: true } })),
    false
  );
});

test('non-Enter keys do not submit', () => {
  assert.equal(shouldSubmitChatMessageKey(keyEvent({ key: 'a', code: 'KeyA' })), false);
});
