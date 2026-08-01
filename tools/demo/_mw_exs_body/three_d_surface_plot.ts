const { ThreeDAxes, ThreeDScene, Surface3D, ORANGE, BLUE, scene, params } = ctx;
const sigma = 0.4;
  const mu = [0.0, 0.0];

  // Gaussian surface: Z-up Manim convention — height is along z.
  const gaussSurface = new Surface3D({
    func: (u: number, v: number) => {
      const x = u;
      const y = v;
      const dx = x - mu[0];
      const dy = y - mu[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      const z = Math.exp(-(d * d) / (2.0 * sigma * sigma));
      return [x, y, z];
    },
    uRange: [-2, 2],
    vRange: [-2, 2],
    uResolution: 24,
    vResolution: 24,
    checkerboardColors: [ORANGE, BLUE],
    opacity: 0.85,
  });

  // Scale by 2 about origin (matches Python: gauss_plane.scale(2, about_point=ORIGIN)).
  // Without an explicit aboutPoint, scale() pivots about the surface's geometric
  // center (z≈0.5), which would push the flat base below the z=0 plane.
  gaussSurface.scale(2, { aboutPoint: [0, 0, 0] });

  const axes = new ThreeDAxes({
    xRange: [-6, 6, 1],
    yRange: [-5, 5, 1],
    zRange: [-4, 4, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });

  scene.add(axes);
  scene.add(gaussSurface);
  await scene.wait(999999);