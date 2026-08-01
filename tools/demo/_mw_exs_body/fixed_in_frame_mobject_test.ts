const { Text, ThreeDAxes, ThreeDScene, UL, scene, params } = ctx;
const axes = new ThreeDAxes({
    xRange: [-6, 6, 1],
    yRange: [-5, 5, 1],
    zRange: [-4, 4, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });
  const text3d = new Text({ text: 'This is a 3D text' });
  scene.addFixedInFrameMobjects(text3d);
  text3d.toCorner(UL);
  scene.add(axes);
  await scene.wait(999999);