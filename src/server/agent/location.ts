type Record = { role: string; text: string };

const precise =
  /\b(temperature|temp|weather|forecast|air quality|AQI|traffic|sunrise|sunset|restaurants?|near me|nearby|raining|snowing)\b/i;
const generic =
  /^(?:today|tonight|tomorrow|this week|this weekend|me|my area|my city|here|where i am|your area|current location|my location)$/i;

function placeIn(text: string) {
  const match = text.match(
    /\b(?:in|at|near|for)\s+([\p{L}][\p{L}\s-]{1,45}?)(?=[?.!,]|\s+(?:today|tomorrow|right now|currently|this week)\b|$)/iu,
  );
  const name = match?.[1]?.trim();
  return name && !generic.test(name) && !/^[A-Za-z]+\/[A-Za-z_]+$/.test(name) ? name : null;
}

export function locationClarification(question: string, history: Record[]) {
  if (!precise.test(question)) return null;
  if (
    placeIn(question) ||
    /\b[\p{Lu}][\p{Ll}]{2,}(?:\s+[\p{Lu}][\p{Ll}]+)?\s+(?:weather|temperature|forecast|AQI)\b/u.test(
      question,
    )
  )
    return null;
  for (const item of history.slice(-4).reverse()) {
    if (item.role !== 'user') continue;
    const selfReport = item.text
      .match(/\b(?:my city is|i live in|i am in|i'm in)\s+([\p{L}][\p{L}\s-]{1,45})/iu)?.[1]
      ?.trim();
    if (selfReport && !generic.test(selfReport)) return null;
    // The most recent explicit weather location can carry into a follow-up.
    if (precise.test(item.text) && placeIn(item.text)) return null;
  }
  return 'Which city or location should I check?';
}
