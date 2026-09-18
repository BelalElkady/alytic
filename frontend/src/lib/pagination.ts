export type PageItem = number | "gap";

/**
 * The page numbers a pager shows: always the first and last page and the
 * current one with a neighbour on each side, with "gap" where pages are left
 * out — 1 … 4 5 6 … 12. A gap is only used when it hides two or more pages;
 * hiding a single page would take the same room as showing it.
 */
export function pageItems(current: number, total: number): PageItem[] {
  if (total < 1) return [];
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...wanted].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const items: PageItem[] = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined) {
      if (page - previous === 2) items.push(previous + 1);
      else if (page - previous > 2) items.push("gap");
    }
    items.push(page);
  });
  return items;
}
