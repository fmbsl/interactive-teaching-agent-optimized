const { scene, Axes, BLUE, Dot, MoveAlongPath, MovingCameraScene, ORANGE, Restore, linear, np } = ctx;
scene.camera.frame.saveState();
  const ax = new Axes({ xRange: [-1, 10], yRange: [-1, 10] });
  const graph = ax.plot((x) => np.sin(x), { color: BLUE, xRange: [0, 3 * Math.PI] });
  const movingDot = new Dot({ point: ax.i2gp(graph.tMin, graph), color: ORANGE });
  const dot1 = new Dot({ point: ax.i2gp(graph.tMin, graph) });
  const dot2 = new Dot({ point: ax.i2gp(graph.tMax, graph) });
  scene.add(ax, graph, dot1, dot2, movingDot);
  await scene.play(scene.camera.frame.animate.scale(0.5).moveTo(movingDot));
  const updateCurve = (mob) => {
    mob.moveTo(movingDot.getCenter());
  };
  scene.camera.frame.addUpdater(updateCurve);
  await scene.play(new MoveAlongPath(movingDot, { path: graph, rateFunc: linear }));
  scene.camera.frame.removeUpdater(updateCurve);
  await scene.play(new Restore(scene.camera.frame));