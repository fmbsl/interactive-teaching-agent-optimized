const { Circle, ThreeDAxes, ThreeDScene, scene, params } = ctx;
const axes = new ThreeDAxes({
    xRange: [-6, 6, 1],
    yRange: [-5, 5, 1],
    zRange: [-4, 4, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });

  const circle = new Circle({ radius: 1, color: '#FC6255' });
  scene.add(circle, axes);

  // Begin ambient camera rotation (theta rotates at 0.1 rad/s)
  scene.beginAmbientCameraRotation(0.1);
  await scene.wait(3);

  // Stop rotation and animate camera back to original orientation
  scene.stopAmbientCameraRotation();
  await scene.moveCamera({
    phi: 75 * (Math.PI / 180),
    theta: 30 * (Math.PI / 180),
    duration: 1,
  });
  await scene.wait(1);