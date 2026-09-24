// "40 posts", "1 feed": a count with its noun. Pages show it inside
// <span class="nowrap">, so the number and the word never part at a line
// end, while the text keeps a plain space for copying. No imports, so the
// page scripts can use it too.
export const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
