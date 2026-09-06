/** Small formatting helpers shared across commands. */

/** A Date (or an already-serialized date string) as an ISO-8601 string. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** First line, whitespace collapsed, truncated with an ellipsis past `max`. */
export function oneLine(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
