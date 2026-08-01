from manim import *


class SaddleScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=70 * DEGREES, theta=-45 * DEGREES)
        axes = ThreeDAxes(x_range=[-3, 3, 1], y_range=[-3, 3, 1], z_range=[-3, 3, 1], x_length=6, y_length=6, z_length=6)
        self.play(Create(axes))
        saddle = Surface(lambda u, v: [u, v, 0.5 * (u * u - v * v)], u_range=[-2, 2], v_range=[-2, 2], color=BLUE_C, fill_opacity=0.7)
        self.play(Create(saddle))
        self.begin_ambient_camera_rotation()
        title = Text("马鞍面 z = (x^2 - y^2)/2", font="Microsoft YaHei", font_size=28, color=BLUE)
        title.to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        self.wait(3)
