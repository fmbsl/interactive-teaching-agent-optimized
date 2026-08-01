const { scene, Circle, ThreeDAxes, ThreeDScene } = ctx;
const axes = new ThreeDAxes();
  const circle = new Circle();
  scene.setCameraOrientation(75 * (Math.PI / 180), 30 * (Math.PI / 180));
  scene.add(circle, axes);
  scene.begin3DIllusionCameraRotation(2);
  await scene.wait(Math.PI / 2);
  scene.stop3DIllusionCameraRotation();