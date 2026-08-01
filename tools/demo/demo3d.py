from manim import *
import math


class Demo3DScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=70 * math.pi / 180, theta=-45 * math.pi / 180)
        axes = ThreeDAxes(x_range=[-3, 3, 1], y_range=[-3, 3, 1], z_range=[-2, 2, 1], x_length=6, y_length=6, z_length=4)
        saddle = Surface(lambda u, v: [u, v, 0.5 * (u * u - v * v)], u_range=[-2, 2], v_range=[-2, 2], color=BLUE_C, fill_opacity=0.7)
        torus = Torus(major_radius=1.2, minor_radius=0.3, color=BLUE_B)
        torus.move_to([2.6, 2.6, 1.1])
        cone = Cone(base_radius=0.5, height=1.2, color=WHITE)
        cone.move_to([-2.6, -2.6, 0.6])
        line = Line3D(start=[-2.6, 2.6, 0], end=[-2.6, 2.6, 2], thickness=0.06, color=BLUE_D)
        title = Text("3D 转换器演示", font="Microsoft YaHei", font_size=28, color=WHITE)
        title.to_edge(UP)
        self.play(Create(axes))
        self.play(Create(saddle))
        self.play(FadeIn(torus), FadeIn(cone), Create(line))
        self.add_fixed_in_frame_mobjects(title)
        self.play(Write(title))
        self.begin_ambient_camera_rotation(0.15)
        self.wait(4)
        self.stop_ambient_camera_rotation()
