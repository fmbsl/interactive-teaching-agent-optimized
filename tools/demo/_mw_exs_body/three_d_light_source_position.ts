const { ThreeDAxes, ThreeDScene, Surface3D, RED_D, RED_E, scene, params } = ctx;
const axes = new ThreeDAxes({
    xRange: [-5, 5, 1],
    yRange: [-5, 5, 1],
    zRange: [-5, 5, 1],
    axisColor: '#ffffff',
    tipLength: 0.2,
    tipRadius: 0.08,
    shaftRadius: 0.01,
  });

  // Checkerboard sphere matching Python Manim's Surface(..., checkerboard_colors=[RED_D, RED_E])
  const sphere = new Surface3D({
    func: (u: number, v: number) => [
      1.5 * Math.cos(u) * Math.cos(v),
      1.5 * Math.cos(u) * Math.sin(v),
      1.5 * Math.sin(u),
    ],
    uRange: [-Math.PI / 2, Math.PI / 2],
    vRange: [0, 2 * Math.PI],
    uResolution: 15,
    vResolution: 32,
    checkerboardColors: [RED_D, RED_E],
  });

  // Light from above to match Python Manim's default top-lit appearance
  scene.lighting.removeAll();
  scene.lighting.addAmbient({ intensity: 0.3 });
  scene.lighting.addPoint({ position: [0, 5, 0], intensity: 2.5, decay: 0 });

  scene.add(axes);
  scene.add(sphere);

  await scene.wait(999999);