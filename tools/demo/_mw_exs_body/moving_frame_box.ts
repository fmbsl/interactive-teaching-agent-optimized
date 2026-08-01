const { Create, MathTexImage, ReplacementTransform, Scene, SurroundingRectangle, Write, scene, params } = ctx;
const text = new MathTexImage({
    latex: ['\\frac{d}{dx}f(x)g(x)=', 'f(x)\\frac{d}{dx}g(x)', '+', 'g(x)\\frac{d}{dx}f(x)'],
  });
  await text.waitForRender();
  await scene.play(new Write(text));
  const framebox1 = new SurroundingRectangle(text.getPart(1), { buff: 0.1 });
  const framebox2 = new SurroundingRectangle(text.getPart(3), { buff: 0.1 });
  await scene.play(new Create(framebox1));
  await scene.wait();
  await scene.play(new ReplacementTransform(framebox1, framebox2));
  await scene.wait();