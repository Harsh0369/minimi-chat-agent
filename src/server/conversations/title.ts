const greetings =
  /^(?:hi|hey|hello|good (?:morning|afternoon|evening)|how are you|thanks|thank you)[!?.\s]*$/i;

export function suggestedTitle(question: string): string | null {
  const plain = question.replace(/\s+/g, ' ').trim();
  if (!plain || greetings.test(plain)) return null;
  const cleaned = plain
    .replace(/^(?:hey|hi|hello)[,!]?\s+/i, '')
    .replace(
      /^(?:can you|could you|please|would you)\s+(?:tell me|explain|show me|help me|check|find)?\s*/i,
      '',
    )
    .replace(
      /^(?:what(?:'s| is| are)|how (?:do|does|can|to)|tell me about|explain|show me|find)\s+/i,
      '',
    )
    .replace(/^(?:how is|how are|is there|are there)\s+/i, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .trim();
  if (!cleaned || greetings.test(cleaned)) return null;
  const words = cleaned.split(' ').slice(0, 9).join(' ');
  const short = words.length > 60 ? `${words.slice(0, 57).trimEnd()}…` : words;
  return short[0]!.toUpperCase() + short.slice(1);
}

export function isPlaceholderTitle(title: string) {
  return title === 'New conversation' || greetings.test(title);
}
