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

  // Begin 3D illusion camera rotation (theta rotates at 2 rad/s,
  // phi oscillates sinusoidally for a wobbling 3D effect)
  scene.begin3DIllusionCameraRotation(2);
  await scene.wait(Math.PI / 2);

  // Stop illusion rotation
  scene.stop3DIllusionCameraRotation();