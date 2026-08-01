const { scene, GREEN, ImageMobject, Scene, SurroundingRectangle, np } = ctx;
const n = 256;
  const imageArray = np.uint8(Array.from({length: (n - 0)}, (_, i) => i + 0).map(() => Array.from({length: (n - 0)}, (_, i) => i + 0).map((i) => (i * 256) / n)));
  const image = new ImageMobject({ arg0: imageArray }).scale(2);
  image.backgroundRectangle = new SurroundingRectangle(image, { color: GREEN });
  scene.add(image, image.backgroundRectangle);