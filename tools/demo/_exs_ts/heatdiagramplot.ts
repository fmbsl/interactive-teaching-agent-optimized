const { scene, Axes, Scene, Tex, np } = ctx;
const ax = new Axes({ xRange: [0, 40, 5], yRange: [-8, 32, 5], xLength: 9, yLength: 6, xAxisConfig: { numbersToInclude: np.arange(0, 40, 5) }, yAxisConfig: { numbersToInclude: np.arange(-5, 34, 5) }, tips: false });
  const labels = ax.getAxisLabels({ xLabel: new Tex({ latex: "$\\Delta Q$" }), yLabel: new Tex({ latex: "T[$^\\circ C$]" }) });
  const xVals = [0, 8, 38, 39];
  const yVals = [20, 0, 0, -5];
  const graph = ax.plotLineGraph({ xValues: xVals, yValues: yVals });
  scene.add(ax, labels, graph);