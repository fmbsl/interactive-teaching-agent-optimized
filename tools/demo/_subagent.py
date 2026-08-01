from manim import *

class TangentLimitScene(Scene):
    def construct(self):
        title = Text("导数的几何意义：切线是割线的极限", font="Microsoft YaHei", font_size=28, color=BLUE)
        title.to_edge(UP)
        self.play(Write(title))
        self.wait(0.3)

        axes = Axes(x_range=[-1.8, 2.4, 1], y_range=[-1.5, 6, 1], x_length=8, y_length=5.5)
        self.play(Create(axes))

        curve = axes.plot(lambda x: x * x, x_range=[-1.7, 2.3], color=BLUE_C)
        curveLabel = MathTex(r"y=x^2", color=BLUE_C).scale(0.7)
        curveLabel.move_to(axes.c2p(-1.4, 4.6))
        self.play(Create(curve), Write(curveLabel))
        self.wait(0.3)

        aX = 1.0
        aY = aX * aX
        pointA = Dot(point=axes.c2p(aX, aY), color=BLUE_B, radius=0.08)
        labelA = Text("A(1,1)", font="Microsoft YaHei", font_size=22, color=WHITE)
        labelA.next_to(pointA, LEFT, buff=0.15)
        self.play(FadeIn(pointA), Write(labelA))
        self.wait(0.3)

        hTracker = ValueTracker(2.2)

        pointB = Dot(point=axes.c2p(hTracker.get_value(), hTracker.get_value() ** 2), color=BLUE_E, radius=0.08)
        pointB.add_updater(lambda m, dt: m.move_to(axes.c2p(hTracker.get_value(), hTracker.get_value() ** 2)))
        labelB = Text("B", font="Microsoft YaHei", font_size=22, color=WHITE)
        labelB.add_updater(lambda m, dt: m.next_to(pointB, RIGHT, buff=0.15))
        self.play(FadeIn(pointB), Write(labelB))
        self.wait(0.3)

        xLeft = -0.2
        xRight = 2.3
        secant = Line(axes.c2p(xLeft, aY + (hTracker.get_value() + 1) * (xLeft - aX)), axes.c2p(xRight, aY + (hTracker.get_value() + 1) * (xRight - aX)), color=BLUE_D, stroke_width=3)
        secant.add_updater(lambda m, dt: m.put_start_and_end_on(axes.c2p(xLeft, aY + (hTracker.get_value() + 1) * (xLeft - aX)), axes.c2p(xRight, aY + (hTracker.get_value() + 1) * (xRight - aX))))
        secantLabel = Text("割线 AB", font="Microsoft YaHei", font_size=20, color=BLUE_D)
        secantLabel.to_edge(LEFT)
        self.play(Create(secant), Write(secantLabel))
        self.wait(0.4)

        slopeFormula = MathTex(r"m_{sec}=\frac{f(h)-f(a)}{h-a}=\frac{h^2-1}{h-1}=h+1", color=WHITE).scale(0.6)
        slopeFormula.to_edge(DOWN, buff=0.4)
        self.play(Write(slopeFormula))
        self.wait(0.5)

        self.play(hTracker.animate.set_value(1.5), run_time=1.4)
        self.wait(0.3)
        self.play(hTracker.animate.set_value(1.2), run_time=1.4)
        self.wait(0.3)
        self.play(hTracker.animate.set_value(1.03), run_time=1.4)
        self.wait(0.4)

        self.play(FadeOut(pointB), FadeOut(labelB))
        self.play(hTracker.animate.set_value(1.0), run_time=1.0)

        tangentLabel = Text("切线（割线的极限位置）", font="Microsoft YaHei", font_size=20, color=BLUE)
        tangentLabel.to_edge(LEFT)
        self.play(FadeOut(secantLabel), FadeIn(tangentLabel), secant.animate.set_color(BLUE))
        self.wait(0.5)

        self.play(FadeOut(slopeFormula))
        derivFormula = MathTex(r"\lim_{h\to a}\frac{f(h)-f(a)}{h-a}=f'(a)=2", color=BLUE).scale(0.65)
        derivFormula.to_edge(DOWN, buff=0.4)
        self.play(Write(derivFormula))
        self.wait(1.8)
