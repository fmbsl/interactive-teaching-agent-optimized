class GradientDescent3DScene(ThreeDScene):
    def construct(self):
        # 相机设置
        self.set_camera_orientation(phi=65 * DEGREES, theta=-50 * DEGREES)

        # 坐标轴与曲面
        axes = ThreeDAxes(x_range=[-4, 4, 1], y_range=[-4, 4, 1], z_range=[0, 6, 1], x_length=7, y_length=7, z_length=5)
        axesLabels = axes.get_axis_labels(MathTex("x"), MathTex("y"), MathTex("z"))
        self.play(Create(axes), Create(axesLabels))

        # 损失曲面 z = 0.3*(x² + y²)
        lossSurface = Surface(lambda u, v: [u, v, 0.3 * (u * u + v * v)], u_range=[-3.5, 3.5], v_range=[-3.5, 3.5], color=BLUE_C, fill_opacity=0.6)
        self.play(Create(lossSurface))

        # 标题钉到屏幕
        title = Text("梯度下降：沿负梯度方向迭代寻优", font="Microsoft YaHei", font_size=26, color=BLUE)
        title.to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)

        # 读取可调参数
        startX = params.startX
        startY = params.startY
        lr = params.lr

        # 初始位置与轨迹
        currentX = startX
        currentY = startY
        currentZ = 0.3 * (currentX * currentX + currentY * currentY)
        ballPos = [currentX, currentY, currentZ]
        ball = Sphere(radius=0.12, color=BLUE_E, opacity=1.0).move_to(ballPos)
        self.play(Create(ball))

        # 标注起始点
        startLabel = Text("初始点", font="Microsoft YaHei", font_size=18, color=WHITE)
        startLabel.next_to(ball, UP, buff=0.3)
        self.add_fixed_in_frame_mobjects(startLabel)
        self.play(FadeIn(startLabel))

        # 轨迹线容器
        trailPoints = [ballPos]

        # 梯度下降迭代（6步）
        for i in range(6):
            # 计算梯度：df/dx = 0.6x, df/dy = 0.6y
            gradX = 0.6 * currentX
            gradY = 0.6 * currentY
            gradNorm = math.sqrt(gradX * gradX + gradY * gradY)

            # 更新位置：沿负梯度方向
            newX = currentX - lr * gradX
            newY = currentY - lr * gradY
            newZ = 0.3 * (newX * newX + newY * newY)
            newPos = [newX, newY, newZ]

            # 梯度向量箭头（在曲面上）
            gradEndX = currentX - 0.4 * gradX / gradNorm if gradNorm > 0.001 else currentX
            gradEndY = currentY - 0.4 * gradY / gradNorm if gradNorm > 0.001 else currentY
            gradEndZ = 0.3 * (gradEndX * gradEndX + gradEndY * gradEndY)
            gradStart = [currentX, currentY, currentZ]
            gradEnd = [gradEndX, gradEndY, gradEndZ]
            gradArrow = Arrow3D(start=gradStart, end=gradEnd, color=WHITE, thickness=0.02)

            # 小球移动 + 梯度箭头出现
            self.play(ball.animate.move_to(newPos), Create(gradArrow), run_time=0.8)
            self.wait(0.2)

            # 移除旧梯度箭头，保留轨迹
            self.remove(gradArrow)

            # 记录轨迹
            trailPoints.append(newPos)
            currentX = newX
            currentY = newY
            currentZ = newZ

        # 绘制完整轨迹线
        for t in range(len(trailPoints) - 1):
            trailSeg = Line3D(start=trailPoints[t], end=trailPoints[t + 1], color=BLUE_D, thickness=0.03)
            self.add(trailSeg)

        # 标注谷底（最小值点）
        bottomDot = Sphere(radius=0.15, color=BLUE_B, opacity=1.0).move_to([0, 0, 0])
        self.play(Create(bottomDot))
        bottomLabel = Text("极小值点 (0,0,0)", font="Microsoft YaHei", font_size=20, color=BLUE_B)
        bottomLabel.next_to(bottomDot, DOWN, buff=0.5)
        self.add_fixed_in_frame_mobjects(bottomLabel)
        self.play(FadeIn(bottomLabel))

        # 环境相机旋转欣赏
        self.begin_ambient_camera_rotation()
        self.wait(4)
        self.stop_ambient_camera_rotation()
        self.wait(1)
