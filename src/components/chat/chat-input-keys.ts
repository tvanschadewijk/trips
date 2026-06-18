type ChatInputKeyEvent = {
  key: string;
  code?: string;
  shiftKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

export function shouldSubmitChatMessageKey(event: ChatInputKeyEvent): boolean {
  const isEnter =
    event.key === 'Enter' ||
    event.key === 'NumpadEnter' ||
    event.code === 'NumpadEnter';

  return isEnter && !event.shiftKey && !event.nativeEvent?.isComposing;
}
