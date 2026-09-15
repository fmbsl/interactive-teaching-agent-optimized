/** Renderer-independent persistence policy for sampled conflicts. Times are milliseconds. */
export class LayoutObservations {
  private active = new Map<string, {start: number; last: number}>();
  observe(keys: string[], time: number, boundary: boolean) {
    const found = new Set(keys);
    for (const key of this.active.keys()) if (!found.has(key)) this.active.delete(key);
    return keys.flatMap(key => {
      let hit = this.active.get(key);
      if (!hit || time - hit.last > 240) hit = {start: time, last: time};
      hit.last = time;
      this.active.set(key, hit);
      return boundary || time - hit.start >= 200 ? [{key, start: hit.start, end: time}] : [];
    });
  }
}
