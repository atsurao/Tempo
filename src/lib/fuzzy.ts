/**
 * Small subsequence matcher for the command palette and search.
 * Returns -1 for no match; higher is better.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    return 1000 - direct * 2 + (direct === 0 ? 200 : 0) + Math.max(0, 50 - t.length);
  }

  let score = 0;
  let qi = 0;
  let lastIndex = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    const atWordStart = ti === 0 || /[\s\-_/.]/.test(t[ti - 1]);
    score += atWordStart ? 18 : 4;
    if (lastIndex === ti - 1) score += 8;
    lastIndex = ti;
    qi++;
  }
  return qi === q.length ? score : -1;
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
