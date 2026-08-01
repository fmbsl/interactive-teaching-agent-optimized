from manim import *
import numpy as np

class Transformer3DScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=-50 * DEGREES)
        title = Text("Transformer 3D 结构", font="Microsoft YaHei", font_size=30, color=BLUE)
        title.to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        layers = ["Input\nEmbedding", "Self-Attention", "Feed-Forward", "Add & Norm", "Output\nLinear"]
        boxes = VGroup()
        labels = VGroup()
        for i, name in enumerate(layers):
            box = Cube(side_length=2.2, fill_opacity=0.25, fill_color=BLUE_C, stroke_color=BLUE)
            box.shift(UP * (3 - i * 1.6))
            label = Text(name, font="Microsoft YaHei", font_size=18, color=BLUE_E)
            label.next_to(box, RIGHT)
            boxes.add(box)
            labels.add(label)
        self.play(Create(boxes), Write(labels))
        self.wait(1)
        for i in range(len(boxes) - 1):
            arrow = Arrow3D(start=boxes.get(i).get_center() + DOWN * 1.1, end=boxes.get(i + 1).get_center() + UP * 1.1, color=BLUE_B)
            self.play(Create(arrow))
        self.wait(2)
        self.begin_ambient_camera_rotation()
        self.wait(4)
        self.stop_ambient_camera_rotation()
