/** Track constructors and resources in one validation, without global mutation. */
export function createVerificationScope(constructors: Record<string, any>, acceptContainer: (container: any) => boolean, boundary?: (scene: any) => Promise<void>, onCreate?: (scene:any) => void) {
  const scenes: { scene: any; kind: string; disposed: boolean }[] = [];
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  let asyncError: unknown;
  const bindings: Record<string, any> = {};
  for (const [kind, Ctor] of Object.entries(constructors)) {
    bindings[kind] = new Proxy(Ctor, {
      construct(target, args) {
        if (closed) throw new Error("验证已结束，不能创建场景");
        if (!acceptContainer(args[0])) throw new Error("验证场景必须创建在本次提供的 container 内");
        const scene: any = Reflect.construct(target, args);
        const entry = { scene, kind, disposed: false };
        scenes.push(entry);
        if(kind !== 'ThreeDScene')onCreate?.(scene);
        const dispose = scene.dispose?.bind(scene);
        scene.dispose = () => {
          if (entry.disposed) return;
          entry.disposed = true;
          dispose?.();
        };
        for (const name of ["play", "wait", "add", "remove", "render"]) {
          if (typeof scene[name] !== "function") continue;
          const method = scene[name].bind(scene);
          scene[name] = (...values: any[]) => {
            if (closed || entry.disposed) throw new Error("验证场景已释放");
            const value = boundary && kind !== 'ThreeDScene' && (name === 'play' || name === 'wait')
              ? (async () => { await boundary(scene); if (closed || entry.disposed) throw new Error('验证场景已释放'); const result = await method(...values); await boundary(scene); return result; })()
              : method(...values);
            if (value && typeof value.then === "function") {
              const observed = Promise.resolve(value).then(
                () => undefined,
                error => { asyncError = error; },
              );
              pending.add(observed);
              void observed.then(() => pending.delete(observed));
            }
            return value;
          };
        }
        return scene;
      },
    });
  }
  return {
    scenes, bindings,
    async drain() {
      while (pending.size) await Promise.all([...pending]);
      if (asyncError) throw asyncError;
    },
    close() {
      closed = true;
      for (const { scene } of scenes) { try { scene.dispose(); } catch { /* release remaining scenes */ } }
    },
  };
}
