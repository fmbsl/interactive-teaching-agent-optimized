const { GOLD, Text, ThreeDAxes, ThreeDScene, scene, params } = ctx;
const axes = new ThreeDAxes({
    xRange: [-6, 6, 1],
    yRange: [-5, 5, 1],
    zRange: [-4, 4, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });

  // Create a label that sits in 3D space but always faces the camera.
  // Small XY offset + GOLD tint so the text reads against the white axis lines
  // without floating away from the origin it labels.
  const label = new Text({ text: 'Origin', fontSize: 32, color: GOLD });
  label.moveTo([0.4, 0.4, 0.3]);

  const xLabel = new Text({ text: 'X', fontSize: 32, color: GOLD });
  xLabel.moveTo([6.8, 0, 0.4]);

  scene.add(axes, label, xLabel);

  // Make the labels always face the camera regardless of orbit angle
  scene.addFixedOrientationMobjects(label, xLabel);

  // Rotate the camera so the billboard effect is visible
  scene.beginAmbientCameraRotation(0.3);
  await scene.wait(999999);