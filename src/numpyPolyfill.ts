// numpy polyfill: 转换器把 np.X(...) 原样保留,前端 ctx 注入此 np 对象兜底。
// 覆盖标量函数(Math.*)、数组构造(arange/linspace/zeros)、linalg、数组方法(argmin/argmax)。
// 注意:不提供 numpy 的逐元素向量化(如 func(array) 做算术),那需要 LLM 用 .map 或 np.vectorize。

export const np: any = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  pow: Math.pow, mod: (a: number, b: number) => a % b,
  pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, nan: NaN,
  array: (x: any) => Array.isArray(x) ? x : [x],
  asarray: (x: any) => Array.isArray(x) ? x : [x],
  arange: (start: number, stop?: number, step?: number) => {
    if (stop === undefined) { stop = start; start = 0; }
    if (step === undefined) step = 1;
    const r: number[] = [];
    for (let v = start; (step! > 0 ? v < stop! : v > stop!); v += step!) r.push(v);
    return r;
  },
  linspace: (start: number, stop: number, num?: number) => {
    if (num === undefined) num = 50;
    if (num <= 1) return [start];
    const r: number[] = [];
    for (let i = 0; i < num; i++) r.push(start + (stop - start) * i / (num - 1));
    return r;
  },
  zeros: (n: number) => new Array(n).fill(0),
  ones: (n: number) => new Array(n).fill(1),
  full: (n: number, v: any) => new Array(n).fill(v),
  uint8: (x: any) => x, int32: (x: any) => x, float32: (x: any) => x, float64: (x: any) => x,
  max: (...a: any[]) => (a.length === 1 && Array.isArray(a[0]) ? Math.max(...a[0]) : Math.max(...a)),
  min: (...a: any[]) => (a.length === 1 && Array.isArray(a[0]) ? Math.min(...a[0]) : Math.min(...a)),
  sum: (a: number[]) => a.reduce((s: number, x: number) => s + x, 0),
  mean: (a: number[]) => a.reduce((s: number, x: number) => s + x, 0) / a.length,
  vectorize: (f: Function) => (x: any) => Array.isArray(x) ? x.map((v: any) => f(v)) : f(x),
  linalg: {
    norm: (v: number[]) => Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0)),
    dot: (a: number[], b: number[]) => a.reduce((s: number, x: number, i: number) => s + x * b[i], 0),
    cross: (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  },
};

// 数组方法补丁:numpy 数组的 .argmin()/.argmax()。仅在数组上有效(标量算术向量化仍不支持)。
if (!(Array.prototype as any).argmin) {
  (Array.prototype as any).argmin = function () { return this.indexOf(Math.min(...this)); };
  (Array.prototype as any).argmax = function () { return this.indexOf(Math.max(...this)); };
}
