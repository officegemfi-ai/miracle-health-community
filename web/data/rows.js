// The API hands back at most 200 rows a request (the project's max_rows), so lists that can be
// longer (the library has 300 entries and grows) come in pages
export const PAGE = 200;

// A list known to run past one page asks for `ahead` pages at a time, so its pages don't arrive one
// round trip after another; it stops at the first short page.
export async function allRows(build, max = 20000, ahead = 1) {
  const rows = [];
  for (let from = 0; from < max; from += PAGE * ahead) {
    const pages = await Promise.all(Array.from({ length: ahead }, (_, i) => build().range(from + i * PAGE, from + (i + 1) * PAGE - 1)));
    for (const { data, error } of pages) {
      if (error || !data) return rows.length ? rows : null;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }
  return rows;
}
