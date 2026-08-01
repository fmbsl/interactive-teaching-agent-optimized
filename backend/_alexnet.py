from manim import *

class AlexNetScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=70 * DEGREES, theta=-60 * DEGREES, distance=18)
        title = Text("AlexNet 结构", font="Microsoft YaHei", font_size=32, color=BLUE)
        title.to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        layers = [("Conv1", 1.6, BLUE_C), ("MaxPool1", 1.2, BLUE_D), ("Conv2", 1.6, BLUE_C), ("MaxPool2", 1.2, BLUE_D), ("Conv3", 1.0, BLUE_E), ("Conv4", 1.0, BLUE_E), ("Conv5", 1.0, BLUE_E), ("MaxPool5", 0.7, BLUE_D), ("FC6", 0.5, BLUE_B), ("FC7", 0.5, BLUE_B), ("FC8", 0.5, BLUE)]
        boxes = VGroup()
        labels = VGroup()
        y = 6.0
        for name, size, color in layers:
            box = Cube(side_length=size, fill_opacity=0.4, fill_color=color, stroke_color=color)
            box.shift(UP * y)
            label = Text(name, font="Microsoft YaHei", font_size=16, color=BLUE_E)
            label.next_to(box, RIGHT, buff=0.3)
            boxes.add(box)
            labels.add(label)
            y = y - size - 0.3
        self.add(boxes, labels)
        self.wait(1)
        for i in range(len(boxes) - 1):
            arrow = Arrow3D(start=boxes.get(i).get_center() + DOWN * 0.8, end=boxes.get(i + 1).get_center() + UP * 0.8, color=BLUE_B, thickness=0.03)
            self.add(arrow)
        self.wait(3)
