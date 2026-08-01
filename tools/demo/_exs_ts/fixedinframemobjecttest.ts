const { scene, Text, ThreeDAxes, ThreeDScene, UL } = ctx;
const axes = new ThreeDAxes();
  scene.setCameraOrientation(75 * (Math.PI / 180), -45 * (Math.PI / 180));
  const text3d = new Text({ text: "This is a 3D text" });
  scene.addFixedInFrameMobjects(text3d);
  text3d.toCorner(UL);
  scene.add(axes);
  await scene.wait(1);