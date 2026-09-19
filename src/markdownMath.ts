/**
 * remark-math expects multiline display-math delimiters to stand on their own
 * lines. Models often emit `$$formula\nmore$$`; normalise that valid TeX into a
 * stable Markdown block before parsing. Fenced code is left untouched.
 */
export function normalizeDisplayMath(markdown: string): string {
  if (!markdown || !markdown.includes("$$")) return markdown;

  const fenced = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  return markdown
    .split(fenced)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\$\$([\s\S]*?)\$\$/g, (_match, body: string) => {
        return `\n\n$$\n${body.trim()}\n$$\n\n`;
      });
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
