from manim import *


class SineFromCircleScene(Scene):
    def construct(self):
        cx = -3.2
        r = 1.4
        circle = Circle(radius=r, color=BLUE, stroke_width=2)
        circle.move_to([cx, 0, 0])
        centerDot = Dot(point=[cx, 0, 0], radius=0.05, color=BLUE_C)
        theta = ValueTracker(0.0)

        circDot = Dot(radius=0.09, color=BLUE_B)
        circDot.add_updater(lambda m: m.move_to([cx + r * np.cos(theta.get_value()), r * np.sin(theta.get_value()), 0]))

        radiusLine = Line([cx, 0, 0], [cx + r, 0, 0], color=BLUE_D, stroke_width=2)
        radiusLine.add_updater(lambda m: m.become(Line([cx, 0, 0], [cx + r * np.cos(theta.get_value()), r * np.sin(theta.get_value()), 0], color=BLUE_D, stroke_width=2)))

        ax = Axes(x_range=[0, 2 * np.pi + 0.3, np.pi / 2], y_range=[-1.5, 1.5, 1], x_length=5.5, y_length=3.0, tips=False)
        ax.shift([1.2, 0, 0])

        sineCurve = ax.plot(lambda t: np.sin(t), x_range=[0, 2 * np.pi], color=BLUE_C)

        sineDot = Dot(radius=0.09, color=BLUE_B)
        sineDot.add_updater(lambda m: m.move_to(ax.c2p(theta.get_value(), np.sin(theta.get_value()))))

        connector = DashedLine([cx + r, 0, 0], [1.2, 0, 0], color=LIGHT_GRAY, stroke_width=1)
        connector.add_updater(lambda m: m.become(DashedLine([cx + r * np.cos(theta.get_value()), r * np.sin(theta.get_value()), 0], ax.c2p(theta.get_value(), np.sin(theta.get_value())), color=LIGHT_GRAY, stroke_width=1)))

        title = Text("圆周运动生成正弦曲线", font="Microsoft YaHei", font_size=28, color=BLUE).to_edge(UP)

        self.play(Write(title))
        self.play(Create(circle), Create(ax), FadeIn(centerDot))
        self.add(circDot, radiusLine, sineDot, connector)
        self.play(theta.animate.set_value(2 * np.pi), Create(sineCurve), run_time=6)
        self.wait(1)
