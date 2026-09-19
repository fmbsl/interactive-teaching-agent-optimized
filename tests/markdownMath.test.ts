import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDisplayMath } from "../src/markdownMath.ts";

test("model-style multiline display math gets standalone delimiters", () => {
  const source = String.raw`得到

$$f(t)=\frac{4A}{\pi}\sum a_k
=\frac{4A}{\pi}\left(\sin\omega t+\cdots\right)$$

### 三条关键结论`;

  const normalized = normalizeDisplayMath(source);
  assert.match(normalized, /\$\$\nf\(t\)=/);
  assert.match(normalized, /\\right\)\n\$\$\n\n### 三条关键结论/);
});

test("fenced examples are not rewritten", () => {
  const source = "```md\n$$x$$\n```";
  assert.equal(normalizeDisplayMath(source), source);
});
