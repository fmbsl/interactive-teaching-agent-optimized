const { scene, BLUE, GREEN, ORANGE, ORIGIN, Surface3D, ThreeDAxes, ThreeDScene, np } = ctx;
const resolutionFa = 24;
  scene.setCameraOrientation(75 * (Math.PI / 180), -30 * (Math.PI / 180));
  const paramGauss = (u, v) => {
    const x = u;
    const y = v;
    const [sigma, mu] = [0.4, [0.0, 0.0]];
    const d = np.linalg.norm(np.array([x - mu[0], y - mu[1]]));
    const z = np.exp((-(Math.pow(d, 2)) / (2.0 * (Math.pow(sigma, 2)))));
    return np.array([x, y, z]);
  };
  const gaussPlane = new Surface3D({ func: paramGauss, resolution: [resolutionFa, resolutionFa], vRange: [-2,[+2]], uRange: [-2,[+2]] });
  gaussPlane.scale(2, { aboutPoint: ORIGIN });
  gaussPlane.setStyle({ fillOpacity: 1, strokeColor: GREEN });
  gaussPlane.setFillByCheckerboard(ORANGE, BLUE, { opacity: 0.5 });
  const axes = new ThreeDAxes();
  scene.add(axes, gaussPlane);