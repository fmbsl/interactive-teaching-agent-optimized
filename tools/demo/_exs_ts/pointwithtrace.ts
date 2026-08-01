const { scene, Dot, LEFT, RIGHT, Rotating, Scene, UP, VMobject } = ctx;
const path = new VMobject();
  const dot = new Dot();
  path.setPointsAsCorners([dot.getCenter(), dot.getCenter()]);
  const updatePath = (path) => {
    const previousPath = path.copy();
    previousPath.addPointsAsCorners([dot.getCenter()]);
    path.become(previousPath);
  };
  path.addUpdater(updatePath);
  scene.add(path, dot);
  await scene.play(new Rotating(dot, { angle: Math.PI, aboutPoint: RIGHT, duration: 2 }));
  await scene.wait(1);
  await scene.play(dot.animate.shift(UP));
  await scene.play(dot.animate.shift(LEFT));
  await scene.wait(1);