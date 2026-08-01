from manim import *


class AlexNetScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=70 * DEGREES, theta=-50 * DEGREES)

        names = ["Conv1", "MaxPool1", "Conv2", "MaxPool2", "Conv3", "Conv4", "Conv5", "MaxPool5", "FC6", "FC7", "FC8"]
        shapes = ["55x55x96", "27x27x96", "27x27x256", "13x13x256", "13x13x384", "13x13x384", "13x13x256", "6x6x256", "4096", "4096", "1000"]
        scales = [[2.0, 2.0, 0.3], [1.6, 1.6, 0.3], [1.6, 1.6, 0.5], [1.2, 1.2, 0.5], [1.2, 1.2, 0.7], [1.2, 1.2, 0.7], [1.2, 1.2, 0.5], [0.8, 0.8, 0.5], [0.4, 0.4, 2.0], [0.4, 0.4, 2.0], [0.4, 0.4, 0.6]]
        colors = [BLUE_C, BLUE_D, BLUE_C, BLUE_D, BLUE_E, BLUE_E, BLUE_E, BLUE_D, BLUE_B, BLUE_B, BLUE]

        xPos = -5.5
        gap = 1.1
        for i in range(len(names)):
            block = Cube(side_length=1.0, color=colors[i], opacity=0.4)
            block.scale(scales[i])
            block.move_to([xPos + i * gap, 0, 0])
            self.play(Create(block), run_time=0.25)
            label = Text(names[i] + " " + shapes[i], font="Microsoft YaHei", font_size=16, color=WHITE)
            label.move_to([xPos + i * gap, 0, scales[i][2] / 2 + 0.4])
            self.add(label)

        title = Text("AlexNet 架构", font="Microsoft YaHei", font_size=32, color=BLUE)
        title.to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        self.play(Write(title))

        for i in range(len(names) - 1):
            startX = xPos + i * gap + scales[i][0] / 2
            endX = xPos + (i + 1) * gap - scales[i + 1][0] / 2
            arrow = Arrow3D(start=[startX, 0, 0], end=[endX, 0, 0], color=WHITE)
            self.play(Create(arrow), run_time=0.2)

        self.begin_ambient_camera_rotation(0.1)
        self.wait(3)
