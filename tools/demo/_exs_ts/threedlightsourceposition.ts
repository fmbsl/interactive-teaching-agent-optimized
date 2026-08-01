const { scene, IN, RED_D, RED_E, Surface3D, ThreeDAxes, ThreeDScene, scaleVec, np } = ctx;
const axes = new ThreeDAxes();
  const sphere = new Surface3D({ func: (u, v) => np.array([(1.5 * np.cos(u)) * np.cos(v), (1.5 * np.cos(u)) * np.sin(v), 1.5 * np.sin(u)]), vRange: [0, 2 * Math.PI], uRange: [[-Math.PI] / 2, Math.PI / 2], checkerboardColors: [RED_D, RED_E], resolution: [15, 32] });
  scene.renderer.camera.lightSource.moveTo(scaleVec(3, IN));
  scene.setCameraOrientation(75 * (Math.PI / 180), 30 * (Math.PI / 180));
  scene.add(axes, sphere);