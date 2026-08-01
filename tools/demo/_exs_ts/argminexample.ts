const { scene, Axes, Dot, MAROON, Scene, ValueTracker, np } = ctx;
const ax = new Axes({ xRange: [0, 10], yRange: [0, 100, 10], axisConfig: { includeTip: false } });
  const labels = ax.getAxisLabels({ xLabel: "x", yLabel: "f(x)" });
  const t = new ValueTracker({ value: 0 });
  const func = (x) => {
    return 2 * (Math.pow(x - 5, 2));
  };
  const graph = ax.plot(func, { color: MAROON });
  const initialPoint = [ax.coordsToPoint(t.getValue(), func(t.getValue()))];
  const dot = new Dot({ point: initialPoint });
  dot.addUpdater((x) => x.moveTo(ax.c2p(t.getValue(), func(t.getValue()))));
  const xSpace = np.linspace(...ax.xRange.slice(0, 2), 200);
  const minimumIndex = func(xSpace).argmin();
  scene.add(ax, labels, graph, dot);
  await scene.play(t.animateTo(xSpace[minimumIndex]));
  await scene.wait(1);