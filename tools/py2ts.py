#!/usr/bin/env python3
"""
py2ts.py — Convert Python Manim scripts to ManimWeb TypeScript (AST-based).

用 Python 标准库 ``ast`` 模块解析源码，结构化生成 TypeScript，从根本上
解决纯正则方案无法处理的嵌套、缩进、kwargs 顺序、字符串截断问题。
2D 与 3D 一视同仁，全部覆盖。

映射表基于 manim-web 0.3.24 的 .d.ts 实测签名。

Usage:
    python tools/py2ts.py input.py [-o output.ts]
    python tools/py2ts.py --test
    cat script.py | python tools/py2ts.py > output.ts

退出码:
    0  成功（可能有警告）
    1  解析错误 / IO 错误
    2  成功，但有不支持语法的警告（转换结果仍写出）
"""

import ast
import sys
import argparse


# ============================================================
# 1. 映射表（基于 manim-web 0.3.24 .d.ts 实测签名）
# ============================================================

# Python 类名 -> ManimWeb TS 类名
CLASS_MAP = {
    # Core
    'Scene': 'Scene', 'Mobject': 'Mobject', 'VMobject': 'VMobject',
    'VGroup': 'VGroup', 'Group': 'Group',
    # Geometry 2D
    'Circle': 'Circle', 'Square': 'Square', 'Rectangle': 'Rectangle',
    'RoundedRectangle': 'RoundedRectangle',
    'Line': 'Line', 'Arrow': 'Arrow', 'DoubleArrow': 'DoubleArrow',
    'Vector': 'Vector', 'Dot': 'Dot', 'SmallDot': 'SmallDot', 'LargeDot': 'LargeDot',
    'Polygon': 'Polygon', 'RegularPolygon': 'RegularPolygon', 'Triangle': 'Triangle',
    'Arc': 'Arc', 'ArcBetweenPoints': 'ArcBetweenPoints',
    'Ellipse': 'Ellipse', 'Annulus': 'Annulus', 'AnnularSector': 'AnnularSector', 'Sector': 'Sector',
    'DashedLine': 'DashedLine', 'CubicBezier': 'CubicBezier',
    'Star': 'Star', 'Angle': 'Angle', 'RightAngle': 'RightAngle',
    'Brace': 'Brace', 'BraceLabel': 'BraceLabel',
    'BackgroundRectangle': 'BackgroundRectangle', 'SurroundingRectangle': 'SurroundingRectangle',
    'Underline': 'Underline', 'Cross': 'Cross',
    # Boolean operations
    'Intersection': 'Intersection', 'Union': 'Union', 'Exclusion': 'Exclusion', 'Difference': 'Difference',
    # Image
    'ImageMobject': 'ImageMobject',
    # Text
    'Text': 'Text', 'MathTex': 'MathTex', 'Tex': 'Tex',
    'MarkupText': 'MarkupText', 'Paragraph': 'Paragraph', 'Title': 'Title',
    'DecimalNumber': 'DecimalNumber', 'Integer': 'Integer', 'Variable': 'Variable',
    # Graphing
    'Axes': 'Axes', 'NumberPlane': 'NumberPlane', 'NumberLine': 'NumberLine',
    'FunctionGraph': 'FunctionGraph', 'ParametricFunction': 'ParametricFunction',
    'BarChart': 'BarChart', 'ComplexPlane': 'ComplexPlane',
    # 3D  (ThreeDScene 保留为 ThreeDScene，使 3D 相机方法类型正确)
    'ThreeDScene': 'ThreeDScene',
    'MovingCameraScene': 'MovingCameraScene',
    'Surface': 'Surface3D',
    'ParametricSurface': 'ParametricSurface',
    'Sphere': 'Sphere', 'Cube': 'Cube', 'Box3D': 'Box3D',
    'Cylinder': 'Cylinder', 'Cone': 'Cone', 'Torus': 'Torus',
    'Prism': 'Prism',
    'Arrow3D': 'Arrow3D', 'Line3D': 'Line3D', 'Dot3D': 'Dot3D', 'Vector3D': 'Vector3D',
    'ThreeDAxes': 'ThreeDAxes',
    'Tetrahedron': 'Tetrahedron', 'Octahedron': 'Octahedron',
    'Icosahedron': 'Icosahedron', 'Dodecahedron': 'Dodecahedron',
    # Tables / Matrix
    'Matrix': 'Matrix', 'IntegerMatrix': 'IntegerMatrix', 'DecimalMatrix': 'DecimalMatrix',
    'Table': 'Table', 'MathTable': 'MathTable',
    # Animations - Creation
    'Create': 'Create', 'Uncreate': 'Uncreate', 'ShowCreation': 'Create',
    'DrawBorderThenFill': 'DrawBorderThenFill',
    'Write': 'Write', 'Unwrite': 'Unwrite',
    'AddTextLetterByLetter': 'AddTextLetterByLetter',
    # Animations - Fading
    'FadeIn': 'FadeIn', 'FadeOut': 'FadeOut',
    # Animations - Transform
    'Transform': 'Transform', 'ReplacementTransform': 'ReplacementTransform',
    'TransformFromCopy': 'TransformFromCopy',
    'ClockwiseTransform': 'ClockwiseTransform',
    'CounterclockwiseTransform': 'CounterclockwiseTransform',
    'MoveToTarget': 'MoveToTarget',
    'ApplyMethod': 'ApplyMethod', 'ApplyFunction': 'ApplyFunction', 'ApplyMatrix': 'ApplyMatrix',
    'FadeTransform': 'FadeTransform', 'FadeTransformPieces': 'FadeTransformPieces',
    'TransformMatchingShapes': 'TransformMatchingShapes',
    'Swap': 'Swap', 'CyclicReplace': 'CyclicReplace',
    'Restore': 'Restore', 'ScaleInPlace': 'ScaleInPlace', 'ShrinkToCenter': 'ShrinkToCenter',
    'FadeToColor': 'FadeToColor',
    # Animations - Movement
    'Shift': 'Shift', 'Rotate': 'Rotate', 'Scale': 'Scale',
    'GrowFromCenter': 'GrowFromCenter', 'GrowArrow': 'GrowArrow',
    'GrowFromEdge': 'GrowFromEdge', 'GrowFromPoint': 'GrowFromPoint',
    'SpinInFromNothing': 'SpinInFromNothing', 'MoveAlongPath': 'MoveAlongPath',
    # Animations - Indication
    'Indicate': 'Indicate', 'Flash': 'Flash', 'Circumscribe': 'Circumscribe',
    'Wiggle': 'Wiggle', 'ShowPassingFlash': 'ShowPassingFlash',
    'ApplyWave': 'ApplyWave', 'FocusOn': 'FocusOn',
    # Animations - Composition
    'AnimationGroup': 'AnimationGroup', 'LaggedStart': 'LaggedStart',
    'LaggedStartMap': 'LaggedStartMap', 'Succession': 'Succession',
    # Animations - Updater
    'UpdateFromFunc': 'UpdateFromFunc', 'UpdateFromAlphaFunc': 'UpdateFromAlphaFunc',
    # Animations - Utility
    'Rotating': 'Rotating', 'Broadcast': 'Broadcast',
    # Misc
    'ValueTracker': 'ValueTracker', 'ImageMobject': 'ImageMobject', 'SVGMobject': 'SVGMobject',
    'PointCloudDot': 'PointCloudDot', 'PGroup': 'PGroup',
}

# Animation 类：构造模式 'anim' = 位置参数保留 + kwargs 转 options 对象
ANIMATION_CLASSES = {
    'Create', 'Uncreate', 'ShowCreation', 'DrawBorderThenFill', 'Write', 'Unwrite',
    'AddTextLetterByLetter',
    'FadeIn', 'FadeOut',
    'Transform', 'ReplacementTransform', 'TransformFromCopy', 'ClockwiseTransform',
    'CounterclockwiseTransform', 'MoveToTarget', 'ApplyMethod', 'ApplyFunction', 'ApplyMatrix',
    'FadeTransform', 'FadeTransformPieces', 'TransformMatchingShapes',
    'Swap', 'CyclicReplace', 'Restore', 'ScaleInPlace', 'ShrinkToCenter', 'FadeToColor',
    'Shift', 'Rotate', 'Scale', 'GrowFromCenter', 'GrowArrow', 'GrowFromEdge', 'GrowFromPoint',
    'SpinInFromNothing', 'MoveAlongPath',
    'Indicate', 'Flash', 'Circumscribe', 'Wiggle', 'ShowPassingFlash', 'ApplyWave', 'FocusOn',
    'UpdateFromFunc', 'UpdateFromAlphaFunc',
    # mobject 但构造签名是 (mobject, opts),借用 anim 模式(位置参 + opts 对象)
    'SurroundingRectangle', 'BackgroundRectangle',
    'Rotating', 'Broadcast',
}

# varargs 类：可变位置参数 + 可选 options。'pure_varargs' 无 options，'varargs_opts' 有 options
PURE_VARARGS_CLASSES = {'VGroup', 'Group', 'PGroup'}
VARARGS_OPTS_CLASSES = {'AnimationGroup', 'LaggedStart', 'LaggedStartMap', 'Succession'}

# 'options' 模式类的位置参数 -> options key 名（已是 TS camelCase）
# 特殊 aggregate key（'vertices', 'latex'）：所有位置参数打包成数组
CLASS_POSITIONAL = {
    'Circle': ['radius'],
    'Dot': ['point'], 'SmallDot': ['point'], 'LargeDot': ['point'],
    'Dot3D': ['point'],
    'Line': ['start', 'end'],
    'Arrow': ['start', 'end'], 'DoubleArrow': ['start', 'end'],
    'DashedLine': ['start', 'end'],
    'Vector': ['end'],
    'Arrow3D': ['start', 'end'], 'Line3D': ['start', 'end'], 'Vector3D': ['end'],
    'Polygon': ['vertices'],
    'Square': ['sideLength'],
    'Cube': ['sideLength'],
    'Rectangle': ['width', 'height'], 'RoundedRectangle': ['width', 'height'],
    'Box3D': ['width', 'height', 'depth'],
    'Arc': ['radius'],
    'ArcBetweenPoints': ['start', 'end'],
    'Text': ['text'], 'MarkupText': ['text'], 'Paragraph': ['text'], 'Title': ['text'],
    'MathTex': ['latex'], 'Tex': ['latex'],
    'Sphere': ['radius'],
    'Cylinder': ['radius', 'height'],
    'Cone': ['radius', 'height'],
    'Torus': ['radius', 'tubeRadius'],
    'Surface': ['func'], 'ParametricSurface': ['func'],
    'Brace': ['mobject'],
    'Angle': ['line1', 'line2'],
    'Annulus': ['innerRadius', 'outerRadius'],
    'Sector': ['radius'],
    'Star': ['outerRadius'],
    'ValueTracker': ['value'],
    'DecimalNumber': ['value'], 'Integer': ['value'],
    'Prism': ['sides'],
}

# 位置参数 key 中需要"聚合成数组"的（多个位置参数 -> 单个数组值）
AGGREGATE_KEYS = {'vertices', 'latex'}

# kwarg snake_case -> TS key（含特殊重命名）
KWARG_RENAME = {
    'run_time': 'duration',
    'rate_func': 'rateFunc',
    'fill_opacity': 'fillOpacity',
    'fill_color': 'fillColor',
    'stroke_width': 'strokeWidth',
    'stroke_color': 'strokeColor',
    'stroke_opacity': 'strokeOpacity',
    'font_size': 'fontSize',
    'font_family': 'fontFamily',
    'font': 'fontFamily',
    'font_weight': 'fontWeight',
    'side_length': 'sideLength',
    'arc_center': 'arcCenter',
    'tip_length': 'tipLength',
    'tip_width': 'tipWidth',
    'num_points': 'numPoints',
    'x_range': 'xRange', 'y_range': 'yRange', 'z_range': 'zRange',
    'u_range': 'uRange', 'v_range': 'vRange',
    'u_resolution': 'uResolution', 'v_resolution': 'vResolution',
    'x_length': 'xLength', 'y_length': 'yLength', 'z_length': 'zLength',
    'axis_config': 'axisConfig',
    'x_axis_config': 'xAxisConfig', 'y_axis_config': 'yAxisConfig', 'z_axis_config': 'zAxisConfig',
    'include_ticks': 'includeTicks',
    'include_numbers': 'includeNumbers',
    'include_tip': 'includeTip',
    'tick_size': 'tickSize',
    'numbers_to_exclude': 'numbersToExclude',
    'decimal_places': 'decimalPlaces',
    'num_decimal_places': 'decimalPlaces',
    'include_sign': 'includeSign',
    'lag_ratio': 'lagRatio',
    'about_point': 'aboutPoint',
    'about_edge': 'aboutEdge',
    'buff': 'buff',
    'background_line_style': 'backgroundLineStyle',
    'number_scale_value': 'numberScaleValue',
    'line_to_number_buff': 'lineToNumberBuff',
    'bar_width': 'barWidth',
    'bar_separation': 'barSeparation',
    'x_values': 'xValues', 'y_values': 'yValues',
    'line_color': 'lineColor',
    'add_vertex_dots': 'addVertexDots',
    'vertex_dot_radius': 'vertexDotRadius',
    'vertex_dot_style': 'vertexDotStyle',
    'x_label': 'xLabel', 'y_label': 'yLabel',
    'base_radius': 'radius',
    'major_radius': 'radius',
    'minor_radius': 'tubeRadius',
    'thickness': 'lineWidth',
    'show_labels': 'showLabels',
    'show_ticks': 'showTicks',
    'tick_length': 'tickLength',
    'shaft_radius': 'shaftRadius',
    'tip_radius': 'tipRadius',
    'radial_segments': 'radialSegments',
    'checkerboard_colors': 'checkerboardColors',
    'double_sided': 'doubleSided',
}

# 方法名映射（self/obj 上的 snake_case 方法 -> camelCase；含特殊重命名）
METHOD_RENAME = {
    'set_color': 'setColor',
    'set_fill': 'setFill',
    'set_stroke': 'setStroke',
    'set_opacity': 'setStrokeOpacity',
    'set_style': 'setStyle',
    'set_z_index': 'setZIndex',
    'set_value': 'setValue',
    'get_value': 'getValue',
    'get_center': 'getCenter',
    'get_top': 'getTop', 'get_bottom': 'getBottom',
    'get_left': 'getLeft', 'get_right': 'getRight',
    'get_start': 'getStart', 'get_end': 'getEnd',
    'get_width': 'getWidth', 'get_height': 'getHeight',
    'move_to': 'moveTo',
    'next_to': 'nextTo',
    'shift': 'shift', 'scale': 'scale', 'rotate': 'rotate', 'flip': 'flip',
    'stretch': 'stretch',
    'to_edge': 'toEdge', 'to_corner': 'toCorner',
    'align_to': 'alignTo',
    'add_updater': 'addUpdater',
    'remove_updater': 'removeUpdater',
    'become': 'become', 'copy': 'copy',
    'get_graph': 'getGraph',
    'get_graph_label': 'getGraphLabel',
    'coords_to_point': 'coordsToPoint',
    'point_to_coords': 'pointToCoords',
    'get_origin': 'getOrigin',
    'get_area': 'getArea',
    'get_riemann_rectangles': 'getRiemannRectangles',
    'input_to_graph_point': 'inputToGraphPoint',
    'number_to_point': 'numberToPoint',
    'point_to_number': 'pointToNumber',
    'arrange': 'arrange',
    'arrange_in_grid': 'arrangeInGrid',
    'wait_for_render': 'waitForRender',
    'generate_target': 'generateTarget',
    'save_state': 'saveState',
    'restore': 'restore',
    'rotate_about_origin': 'rotateAboutOrigin',
    'set_points_as_corners': 'setPointsAsCorners',
    'add_points_as_corners': 'addPointsAsCorners',
    'get_axis_labels': 'getAxisLabels',
    'get_vertical_line': 'getVerticalLine',
    'i2gp': 'i2gp', 'plot': 'plot',
    'plot_line_graph': 'plotLineGraph',
    'c2p': 'c2p', 'p2c': 'p2c',
    # Python list 方法 -> JS 数组方法（仅 1:1 可重命名的；extend/insert/remove 需改参数，提示词另禁）
    'append': 'push',
}

# self.<method> -> scene.<method>  (Scene 级方法，非 construct 体内自定义)
# play/wait/add/remove/clear 单独处理；这里放 3D 相机方法与其它 scene 方法
SCENE_METHOD_RENAME = {
    # 3D 相机
    'set_camera_orientation': 'setCameraOrientation',
    'move_camera': 'moveCamera',
    'begin_ambient_camera_rotation': 'beginAmbientCameraRotation',
    'stop_ambient_camera_rotation': 'stopAmbientCameraRotation',
    'begin_3dillusion_camera_rotation': 'begin3DIllusionCameraRotation',
    'stop_3dillusion_camera_rotation': 'stop3DIllusionCameraRotation',
    'add_fixed_in_frame_mobjects': 'addFixedInFrameMobjects',
    'add_fixed_orientation_mobjects': 'addFixedOrientationMobjects',
    'set_look_at': 'setLookAt',
    # 2D scene
    'add_foreground_mobject': 'addForegroundMobject',
    'add_foreground_mobjects': 'addForegroundMobject',
}

# set_camera_orientation 的 kwargs -> 位置参数顺序（ManimWeb: (phi, theta, distance?)）
SET_CAMERA_ORIENTATION_ORDER = ['phi', 'theta', 'distance']

# move_camera 的 kwargs -> options 对象（key 同名，已是 camelCase 友好）
MOVE_CAMERA_KEYS = ['phi', 'theta', 'distance', 'duration']

# play() 级 kwargs -> 注入到每个 animation 的 options key
PLAY_KWARG_MAP = {
    'run_time': 'duration',
    'rate_func': 'rateFunc',
    'lag_ratio': 'lagRatio',
}

# 颜色常量（manim-web 导出为同名 CSS 字符串 const）
COLORS = {
    'WHITE', 'BLACK', 'GRAY', 'GREY',
    'BLUE', 'BLUE_A', 'BLUE_B', 'BLUE_C', 'BLUE_D', 'BLUE_E', 'PURE_BLUE',
    'RED', 'RED_A', 'RED_B', 'RED_C', 'RED_D', 'RED_E', 'PURE_RED',
    'GREEN', 'GREEN_A', 'GREEN_B', 'GREEN_C', 'GREEN_D', 'GREEN_E', 'PURE_GREEN',
    'YELLOW', 'YELLOW_A', 'YELLOW_B', 'YELLOW_C', 'YELLOW_D', 'YELLOW_E',
    'ORANGE', 'PINK', 'PURPLE', 'PURPLE_A', 'PURPLE_B', 'PURPLE_C', 'PURPLE_D', 'PURPLE_E',
    'TEAL', 'TEAL_A', 'TEAL_B', 'TEAL_C', 'TEAL_D', 'TEAL_E',
    'GOLD', 'GOLD_A', 'GOLD_B', 'GOLD_C', 'GOLD_D', 'GOLD_E',
    'MAROON', 'MAROON_A', 'MAROON_B', 'MAROON_C', 'MAROON_D', 'MAROON_E',
    'GRAY_A', 'GRAY_B', 'GRAY_C', 'GRAY_D', 'GRAY_E',
    'GREY_A', 'GREY_B', 'GREY_C', 'GREY_D', 'GREY_E',
    'LIGHT_GRAY', 'DARK_GRAY', 'LIGHTER_GREY', 'DARKER_GREY',
    'LIGHTER_GRAY', 'DARKER_GRAY',
}
# GREY* -> GRAY* 重命名（manim-web 只导出 GRAY/GRAY_A..，GREY 是别名）
GREY_TO_GRAY = {
    'GREY': 'GRAY', 'GREY_A': 'GRAY_A', 'GREY_B': 'GRAY_B',
    'GREY_C': 'GRAY_C', 'GREY_D': 'GRAY_D', 'GREY_E': 'GRAY_E',
    'LIGHTER_GREY': 'LIGHTER_GRAY', 'DARKER_GREY': 'DARKER_GRAY',
}

# 方向常量（manim-web 导出同名）
DIRECTIONS = {
    'UP', 'DOWN', 'LEFT', 'RIGHT', 'ORIGIN',
    'OUT', 'IN', 'UL', 'UR', 'DL', 'DR',
    'UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT',
}

# rate function 映射
RATE_FUNC_RENAME = {
    'smooth': 'smooth', 'linear': 'linear',
    'rush_into': 'rushInto', 'rush_from': 'rushFrom',
    'there_and_back': 'thereAndBack',
    'double_smooth': 'doubleSmooth',
    'ease_in_out': 'easeInOut', 'ease_in': 'easeIn', 'ease_out': 'easeOut',
    'there_and_back_with_pause': 'thereAndBackWithPause',
    'wiggle': 'wiggle', 'squish_rate_func': 'squishRateFunc',
}

# 数学/方向 utility 函数（需用户自行 import 或实现）
UTILITY_FUNCS = {'linspace', 'scaleVec', 'matMul', 'range'}


# ============================================================
# 2. 工具函数
# ============================================================

def snake_to_camel(s):
    """snake_case -> camelCase。全大写段（如 UP）不动。"""
    if not s:
        return s
    # 保留全大写常量
    if s.isupper():
        return s
    parts = s.split('_')
    if len(parts) == 1:
        return s
    return parts[0] + ''.join(p.capitalize() for p in parts[1:] if p)


def rename_kwarg(key):
    """kwarg key 的重命名：先查表，否则 snake->camel。"""
    if key in KWARG_RENAME:
        return KWARG_RENAME[key]
    return snake_to_camel(key)


def rename_method(name):
    """方法名重命名。"""
    if name in METHOD_RENAME:
        return METHOD_RENAME[name]
    return snake_to_camel(name)


# ============================================================
# 3. TS 代码生成器
# ============================================================

class Gen:
    """递归访问 Python AST，生成 TypeScript 字符串。"""

    def __init__(self):
        self.imports = set()         # 需从 manim-web import 的符号
        self.utilities = set()       # 需用户自行提供的 utility 函数
        self.warnings = []           # 警告列表 (line, message)
        # 作用域栈：每层是 dict{name: assign_count}
        self.scopes = [{}]
        # play() 注入：当前 play 的 opts 字符串，供 Animation 实例化时注入
        self.current_play_opts = None
        # 跟踪 MathTex/Tex 变量（创建后需 waitForRender）
        self.math_tex_vars = set()
        # 当前函数是否已声明某名字（用于 const/let 决策）
        self.declared = [set()]

    # ---------- 作用域 ----------
    def push_scope(self):
        self.scopes.append({})
        self.declared.append(set())

    def pop_scope(self):
        self.scopes.pop()
        self.declared.pop()

    def count_assign(self, name):
        """记录一次赋值，返回这是该作用域内第几次赋值。"""
        scope = self.scopes[-1]
        scope[name] = scope.get(name, 0) + 1
        return scope[name]

    def assign_count(self, name):
        """当前作用域内对该名字的总赋值次数（用于决定 let/const）。"""
        # 向上查找最近定义该名字的作用域
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]
        return 0

    def is_declared(self, name):
        for d in self.declared:
            if name in d:
                return True
        return False

    def mark_declared(self, name):
        self.declared[-1].add(name)

    # ---------- 警告 ----------
    def warn(self, node, msg):
        line = getattr(node, 'lineno', 0)
        self.warnings.append((line, msg))

    # ---------- import 跟踪 ----------
    def use(self, sym):
        """记录需要从 manim-web 导入的符号。"""
        self.imports.add(sym)

    # ============================================================
    # 模块 / 类 / 函数
    # ============================================================

    def convert_module(self, tree):
        """顶层：提取所有 Scene 子类，转成导出函数。"""
        scenes = []
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                scene = self.convert_class(node)
                if scene:
                    scenes.append(scene)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                self.handle_import(node)
            elif isinstance(node, ast.FunctionDef):
                # 顶层函数：转成普通导出函数（无 scene 参数）
                self.warn(node, "顶层函数定义将转换为模块级函数（无 self/scene 参数）")
                scenes.append(self.convert_top_func(node))
            elif isinstance(node, ast.Expr) and isinstance(node.value, (ast.Constant, ast.JoinedStr)):
                pass  # 模块文档字符串，跳过
            else:
                self.warn(node, f"模块级语句不转换：{type(node).__name__}")

        if not scenes:
            # 回退：整个文件当一个 scene
            self.warn(tree, "未找到 Scene 子类，将整个文件体作为单个函数处理")
            body = [s for s in tree.body if not isinstance(s, (ast.Import, ast.ImportFrom))]
            scenes.append(self.build_scene_fallback(body))

        return self.build_output(scenes)

    def handle_import(self, node):
        """跳过 manim/numpy 导入；其它 import 记录警告。"""
        if isinstance(node, ast.ImportFrom):
            mod = node.module or ''
            if mod.startswith('manim') or mod.startswith('numpy'):
                return
            self.warn(node, f"未转换的 import: from {mod} import ...")
        else:
            for alias in node.names:
                if alias.name.startswith('manim') or alias.name == 'numpy':
                    continue
                self.warn(node, f"未转换的 import: import {alias.name}")

    def convert_class(self, node):
        """class Foo(Scene) -> export async function foo(scene: Scene)。"""
        # 解析基类
        base_name = self.base_name(node)
        if base_name is None:
            return None  # 非 Scene 相关类，跳过

        scene_type = CLASS_MAP.get(base_name, 'Scene')
        self.use(scene_type)

        # 函数名：PascalCase -> camelCase，去 Scene 后缀
        cls_name = node.name
        fname = cls_name
        if fname.endswith('Scene') and len(fname) > 5:
            fname = fname[:-len('Scene')]
        if not fname:
            fname = cls_name
        fname = fname[0].lower() + fname[1:] if fname else 'scene'

        # 找 construct 方法
        construct = None
        other_methods = []
        for item in node.body:
            if isinstance(item, ast.FunctionDef) and item.name == 'construct':
                construct = item
            elif isinstance(item, ast.FunctionDef):
                other_methods.append(item)
            elif isinstance(item, ast.Pass):
                pass
            elif isinstance(item, ast.Expr) and isinstance(item.value, (ast.Constant, ast.JoinedStr)):
                pass  # docstring
            else:
                self.warn(item, f"类体内非方法成员不转换：{type(item).__name__} (在 {cls_name})")

        if construct is None:
            self.warn(node, f"类 {cls_name} 无 construct 方法，生成空函数")
            body = []
        else:
            self.push_scope()
            self.pre_scan_assigns(construct.body)
            body = self.emit_stmts(construct.body, indent='  ')
            self.pop_scope()

        # 其它方法：警告（updater 等需手动处理）
        for m in other_methods:
            self.warn(m, f"类方法 {cls_name}.{m.name} 未自动转换（请手动改为闭包/工具函数）")

        return {
            'name': cls_name,
            'func_name': fname,
            'scene_type': scene_type,
            'body': body,
        }

    def base_name(self, node):
        """返回基类名字，若与 Scene 体系无关则 None。"""
        for base in node.bases:
            if isinstance(base, ast.Name):
                if base.id in CLASS_MAP or base.id in ('Scene', 'ThreeDScene', 'MovingCameraScene'):
                    return base.id
        return None

    def convert_top_func(self, node):
        """顶层函数（非类方法）。"""
        fname = snake_to_camel(node.name)
        params = self.emit_params(node.args)
        self.push_scope()
        self.pre_scan_assigns(node.body)
        body = self.emit_stmts(node.body, indent='  ')
        self.pop_scope()
        return {
            'name': node.name,
            'func_name': fname,
            'scene_type': None,  # 顶层函数无 scene 参数
            'params': params,
            'body': body,
        }

    def build_scene_fallback(self, body_stmts):
        self.push_scope()
        self.pre_scan_assigns(body_stmts)
        body = self.emit_stmts(body_stmts, indent='  ')
        self.pop_scope()
        return {
            'name': 'MyScene',
            'func_name': 'myScene',
            'scene_type': 'Scene',
            'body': body,
        }

    # ============================================================
    # 语句 emit
    # ============================================================

    def pre_scan_assigns(self, body):
        """预扫描：统计每个名字在当前作用域的赋值次数，用于 let/const 决策。
        for 循环变量、with/as、except as 也计入。"""
        for node in ast.walk(ast.Module(body=body, type_ignores=[])):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    self._scan_target(t)
            elif isinstance(node, ast.AugAssign):
                self._scan_target(node.target)
            elif isinstance(node, ast.AnnAssign):
                if node.target:
                    self._scan_target(node.target)
            elif isinstance(node, ast.For):
                self._scan_target(node.target)
            elif isinstance(node, ast.NamedExpr):  # walrus
                self._scan_target(node.target)

    def _scan_target(self, t):
        if isinstance(t, ast.Name):
            self.scopes[-1][t.id] = self.scopes[-1].get(t.id, 0) + 1
        elif isinstance(t, (ast.Tuple, ast.List)):
            for el in t.elts:
                self._scan_target(el)
        elif isinstance(t, ast.Starred):
            self._scan_target(t.value)

    def emit_stmts(self, stmts, indent):
        """生成语句块，每条带缩进与分号。返回行列表。"""
        lines = []
        for s in stmts:
            lines.extend(self.emit_stmt(s, indent))
        return lines

    def emit_stmt(self, node, indent):
        if isinstance(node, ast.Pass):
            return []
        if isinstance(node, ast.Expr):
            # 表达式语句
            expr = self.emit_expr(node.value)
            return [f"{indent}{self.terminate(expr)}"]
        if isinstance(node, ast.Assign):
            return self.emit_assign(node, indent)
        if isinstance(node, ast.AugAssign):
            target = self.emit_target(node.target, declare=False)
            op = self.binop_str(node.op)
            val = self.emit_expr(node.value)
            return [f"{indent}{target} {op}= {val};"]
        if isinstance(node, ast.AnnAssign):
            return self.emit_ann_assign(node, indent)
        if isinstance(node, ast.If):
            return self.emit_if(node, indent)
        if isinstance(node, ast.For):
            return self.emit_for(node, indent)
        if isinstance(node, ast.While):
            return self.emit_while(node, indent)
        if isinstance(node, ast.Return):
            if node.value is None:
                return [f"{indent}return;"]
            return [f"{indent}return {self.emit_expr(node.value)};"]
        if isinstance(node, (ast.Break,)):
            return [f"{indent}break;"]
        if isinstance(node, (ast.Continue,)):
            return [f"{indent}continue;"]
        if isinstance(node, ast.Try):
            self.warn(node, "try/except 转为 try/catch，但 except 语义不完全等价（无类型匹配）")
            return self.emit_try(node, indent)
        if isinstance(node, ast.With):
            self.warn(node, "with 语句无法自动转换，已用块包裹但需手动处理上下文管理器")
            return self.emit_with(node, indent)
        if isinstance(node, ast.Raise):
            self.warn(node, "raise 转为 throw")
            if node.exc:
                return [f"{indent}throw {self.emit_expr(node.exc)};"]
            return [f"{indent}throw new Error();"]
        if isinstance(node, ast.Assert):
            self.warn(node, "assert 转为 console.assert（语义不同：生产环境不剔除）")
            test = self.emit_expr(node.test)
            if node.msg:
                msg = self.emit_expr(node.msg)
                return [f"{indent}console.assert({test}, {msg});"]
            return [f"{indent}console.assert({test});"]
        if isinstance(node, ast.Global) or isinstance(node, ast.Nonlocal):
            self.warn(node, f"{type(node).__name__} 在 TS 无直接对应，已忽略（变量已在外层作用域）")
            return []
        if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
            return self.emit_nested_func(node, indent)
        if isinstance(node, ast.Import) or isinstance(node, ast.ImportFrom):
            return []  # 函数内 import 跳过
        if isinstance(node, ast.Delete):
            self.warn(node, "del 语句无法转换（TS 无 delete 变量），已忽略")
            return []

        self.warn(node, f"不支持的语句类型: {type(node).__name__}")
        return [f"{indent}/* TODO: 不支持的语句 {type(node).__name__} */"]

    def terminate(self, expr_str):
        """表达式加终止符。块表达式不加。"""
        s = expr_str.rstrip()
        if s.endswith('}') or s.endswith('{') or s.endswith(';'):
            return s
        return s + ';'

    def emit_assign(self, node, indent):
        """赋值：x = ... 或 x = y = ... 或 a, b = ..."""
        val = self.emit_expr(node.value)
        # 多赋值 x = y = ...
        if len(node.targets) > 1:
            tgts = [self.emit_target(t, declare=False) for t in node.targets]
            return [f"{indent}{tgts[0]} = {tgts[1]} = {val};"]
        target = node.targets[0]
        # 元组解包 a, b = ...
        if isinstance(target, (ast.Tuple, ast.List)):
            elts = [self.emit_target(e, declare=False) for e in target.elts]
            # 解构：const [a, b] = ...  /  [a, b] = ...
            names = [e for e in elts]
            is_first = all(not self.is_declared(self._name_of(e)) for e in target.elts)
            decl = 'const ' if is_first else ''
            for e in target.elts:
                nm = self._name_of(e)
                if nm:
                    self.count_assign(nm)
                    self.mark_declared(nm)
            return [f"{indent}{decl}[{', '.join(names)}] = {val};"]
        # 简单赋值
        name = self._name_of(target)
        is_attr = isinstance(target, ast.Attribute) or isinstance(target, ast.Subscript)
        if name and not is_attr:
            camel = snake_to_camel(name)
            count = self.assign_count(name)
            first_time = not self.is_declared(camel)
            if first_time:
                # 决定 const/let：若该名字在作用域内赋值 >1 次，用 let
                kw = 'let' if count > 1 else 'const'
                self.mark_declared(camel)
                self.count_assign(name)
                # MathTex/Tex 创建后插 waitForRender
                extra = ''
                if self._is_mathtex_value(node.value):
                    self.math_tex_vars.add(camel)
                    extra = f"\n{indent}await {camel}.waitForRender();"
                return [f"{indent}{kw} {camel} = {val};{extra}"]
            else:
                self.count_assign(name)
                return [f"{indent}{camel} = {val};"]
        else:
            tgt = self.emit_target(target, declare=False)
            return [f"{indent}{tgt} = {val};"]

    def _name_of(self, node):
        if isinstance(node, ast.Name):
            return node.id
        return None

    def _is_mathtex_value(self, value):
        if isinstance(value, ast.Call):
            f = value.func
            if isinstance(f, ast.Name) and f.id in ('MathTex', 'Tex'):
                return True
        return False

    def emit_ann_assign(self, node, indent):
        """带类型注解的赋值：x: int = 5"""
        if node.value is None:
            self.warn(node, "仅声明无赋值的类型注解已忽略")
            return []
        val = self.emit_expr(node.value)
        target = self.emit_target(node.target, declare=True)
        return [f"{indent}{target} = {val};"]

    def emit_target(self, node, declare):
        """赋值左侧（不创建 const/let 前缀）。"""
        if isinstance(node, ast.Name):
            return snake_to_camel(node.id)
        if isinstance(node, ast.Attribute):
            return f"{self.emit_expr(node.value)}.{rename_method(node.attr)}"
        if isinstance(node, ast.Subscript):
            return f"{self.emit_expr(node.value)}{self.emit_subscript_slice(node.slice)}"
        if isinstance(node, ast.Starred):
            return f"...{self.emit_target(node.value, declare)}"
        if isinstance(node, (ast.Tuple, ast.List)):
            return '[' + ', '.join(self.emit_target(e, declare) for e in node.elts) + ']'
        self.warn(node, f"不支持的赋值目标: {type(node).__name__}")
        return '/*?*/'

    def emit_if(self, node, indent):
        lines = []
        test = self.emit_expr(node.test)
        lines.append(f"{indent}if ({test}) {{")
        self.push_scope()
        self.pre_scan_assigns(node.body)
        lines.extend(self.emit_stmts(node.body, indent + '  '))
        self.pop_scope()
        # elif / else 链
        orelse = node.orelse
        while orelse and len(orelse) == 1 and isinstance(orelse[0], ast.If):
            elif_node = orelse[0]
            elif_test = self.emit_expr(elif_node.test)
            lines.append(f"{indent}}} else if ({elif_test}) {{")
            self.push_scope()
            self.pre_scan_assigns(elif_node.body)
            lines.extend(self.emit_stmts(elif_node.body, indent + '  '))
            self.pop_scope()
            orelse = elif_node.orelse
        if orelse:
            lines.append(f"{indent}}} else {{")
            self.push_scope()
            self.pre_scan_assigns(orelse)
            lines.extend(self.emit_stmts(orelse, indent + '  '))
            self.pop_scope()
        lines.append(f"{indent}}}")
        return lines

    def emit_for(self, node, indent):
        lines = []
        # for i in range(...) -> for (let i = ...; ...; i++)
        if self.is_range_call(node.iter):
            rng = node.iter
            args = [self.emit_expr(a) for a in rng.args]
            target = self.emit_target(node.target, declare=True)
            if len(args) == 1:
                lines.append(f"{indent}for (let {target} = 0; {target} < {args[0]}; {target}++) {{")
            elif len(args) == 2:
                lines.append(f"{indent}for (let {target} = {args[0]}; {target} < {args[1]}; {target}++) {{")
            elif len(args) == 3:
                step = args[2]
                cmp = '<' if step.lstrip('-').replace('.', '').isdigit() and float(step) > 0 else '>='
                # 简化：假设正步长
                lines.append(f"{indent}for (let {target} = {args[0]}; {target} < {args[1]}; {target} += {step}) {{")
        # for x in enumerate(...) -> 解构
        elif isinstance(node.iter, ast.Call) and isinstance(node.iter.func, ast.Name) and node.iter.func.id == 'enumerate':
            iterable = self.emit_expr(node.iter.args[0]) if node.iter.args else '[]'
            if isinstance(node.target, ast.Tuple) and len(node.target.elts) == 2:
                idx = self.emit_target(node.target.elts[0], declare=True)
                val = self.emit_target(node.target.elts[1], declare=True)
                lines.append(f"{indent}for (const [{idx}, {val}] of {iterable}.entries()) {{")
            else:
                lines.append(f"{indent}for (const {self.emit_target(node.target, declare=True)} of {iterable}.entries()) {{")
        # for a, b in zip(...) -> 需手动处理（TS 无 zip）
        elif isinstance(node.iter, ast.Call) and isinstance(node.iter.func, ast.Name) and node.iter.func.id == 'zip':
            self.warn(node, "zip() 需手动转换为并行数组迭代")
            zipped = ', '.join(self.emit_expr(a) for a in node.iter.args)
            tgt = self.emit_target(node.target, declare=True)
            lines.append(f"{indent}/* TODO: zip 需手动处理 */ for (const {tgt} of [{zipped}][0] ?? []) {{")
        # for x in items
        else:
            iterable = self.emit_expr(node.iter)
            tgt = self.emit_target(node.target, declare=True)
            lines.append(f"{indent}for (const {tgt} of {iterable}) {{")
        self.push_scope()
        self.pre_scan_assigns(node.body)
        lines.extend(self.emit_stmts(node.body, indent + '  '))
        self.pop_scope()
        lines.append(f"{indent}}}")
        return lines

    def is_range_call(self, node):
        return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'range'

    def emit_while(self, node, indent):
        test = self.emit_expr(node.test)
        lines = [f"{indent}while ({test}) {{"]
        self.push_scope()
        self.pre_scan_assigns(node.body)
        lines.extend(self.emit_stmts(node.body, indent + '  '))
        self.pop_scope()
        lines.append(f"{indent}}}")
        return lines

    def emit_try(self, node, indent):
        lines = [f"{indent}try {{"]
        self.push_scope()
        self.pre_scan_assigns(node.body)
        lines.extend(self.emit_stmts(node.body, indent + '  '))
        self.pop_scope()
        for handler in node.handlers:
            lines.append(f"{indent}}} catch ({self._except_name(handler)}) {{")
            self.push_scope()
            self.pre_scan_assigns(handler.body)
            lines.extend(self.emit_stmts(handler.body, indent + '  '))
            self.pop_scope()
        if node.finalbody:
            lines.append(f"{indent}}} finally {{")
            self.push_scope()
            self.pre_scan_assigns(node.finalbody)
            lines.extend(self.emit_stmts(node.finalbody, indent + '  '))
            self.pop_scope()
        lines.append(f"{indent}}}")
        return lines

    def _except_name(self, handler):
        if handler.name:
            return snake_to_camel(handler.name)
        if handler.type and isinstance(handler.type, ast.Name):
            return handler.type.id.lower()
        return 'e'

    def emit_with(self, node, indent):
        """with 语句：尽力转成 IIFE 或直接展开 body（上下文管理器语义丢失）。"""
        lines = [f"{indent}/* TODO: with 语句需手动处理上下文管理器 */ {{"]
        self.push_scope()
        self.pre_scan_assigns(node.body)
        lines.extend(self.emit_stmts(node.body, indent + '  '))
        self.pop_scope()
        lines.append(f"{indent}}}")
        return lines

    def emit_nested_func(self, node, indent):
        """嵌套函数定义 -> const fn = (...) => { ... }"""
        fname = snake_to_camel(node.name)
        params = self.emit_params(node.args)
        self.mark_declared(fname)
        lines = [f"{indent}const {fname} = ({params}) => {{"]
        self.push_scope()
        self.pre_scan_assigns(node.body)
        lines.extend(self.emit_stmts(node.body, indent + '  '))
        self.pop_scope()
        lines.append(f"{indent}}};")
        return lines

    # ============================================================
    # 表达式 emit
    # ============================================================

    def emit_expr(self, node):
        if node is None:
            return 'null'
        if isinstance(node, ast.Constant):
            return self.emit_constant(node)
        if isinstance(node, ast.Name):
            return self.emit_name(node)
        if isinstance(node, ast.Attribute):
            return self.emit_attribute(node)
        if isinstance(node, ast.Call):
            return self.emit_call(node)
        if isinstance(node, ast.BinOp):
            return self.emit_binop(node)
        if isinstance(node, ast.UnaryOp):
            return self.emit_unaryop(node)
        if isinstance(node, ast.BoolOp):
            return self.emit_boolop(node)
        if isinstance(node, ast.Compare):
            return self.emit_compare(node)
        if isinstance(node, ast.IfExp):
            return f"({self.emit_expr(node.test)} ? {self.emit_expr(node.body)} : {self.emit_expr(node.orelse)})"
        if isinstance(node, ast.List):
            return '[' + ', '.join(self.emit_expr(e) for e in node.elts) + ']'
        if isinstance(node, ast.Tuple):
            return '[' + ', '.join(self.emit_expr(e) for e in node.elts) + ']'  # Python tuple -> TS array
        if isinstance(node, ast.Set):
            return 'new Set([' + ', '.join(self.emit_expr(e) for e in node.elts) + '])'
        if isinstance(node, ast.Dict):
            return self.emit_dict(node)
        if isinstance(node, ast.Lambda):
            return self.emit_lambda(node)
        if isinstance(node, ast.ListComp) or isinstance(node, ast.SetComp):
            return self.emit_listcomp(node)
        if isinstance(node, ast.DictComp):
            return self.emit_dictcomp(node)
        if isinstance(node, ast.GeneratorExp):
            self.warn(node, "生成器表达式转为（立即求值的）数组；若依赖惰性求值需手动改写")
            return self.emit_listcomp(node)
        if isinstance(node, ast.Subscript):
            return self.emit_subscript(node)
        if isinstance(node, ast.Starred):
            return '...' + self.emit_expr(node.value)
        if isinstance(node, ast.JoinedStr):
            return self.emit_fstring(node)
        if isinstance(node, ast.FormattedValue):
            return '${' + self.emit_expr(node.value) + '}'
        if isinstance(node, ast.NamedExpr):  # walrus :=
            self.warn(node, "海象运算符 := 转为先赋值再使用")
            name = snake_to_camel(node.target.id)
            self.count_assign(node.target.id)
            return f"({name} = {self.emit_expr(node.value)})"
        if isinstance(node, ast.Await):
            return f"await {self.emit_expr(node.value)}"
        if isinstance(node, ast.Yield) or isinstance(node, ast.YieldFrom):
            self.warn(node, "yield 在 TS 转为普通 return；生成器语义丢失")
            return f"/* yield */ null"

        self.warn(node, f"不支持的表达式: {type(node).__name__}")
        return f"/* TODO: {type(node).__name__} */"

    def emit_constant(self, node):
        v = node.value
        if v is None:
            return 'null'
        if v is True:
            return 'true'
        if v is False:
            return 'false'
        if isinstance(v, str):
            return self.emit_string(v, node)
        if isinstance(v, bytes):
            self.warn(node, "bytes 字面量转为字符串")
            return self.emit_string(v.decode('utf-8', errors='replace'), node)
        if isinstance(v, (int, float)):
            if isinstance(v, float):
                if v != v:  # nan
                    return 'NaN'
                if v == float('inf'):
                    return 'Infinity'
                if v == float('-inf'):
                    return '-Infinity'
            return repr(v)
        if isinstance(v, complex):
            self.warn(node, "复数字面量转为 {re, im} 对象")
            return f"{{ re: {v.real}, im: {v.imag} }}"
        if v is Ellipsis:
            return 'undefined'
        return repr(v)

    def emit_string(self, s, node):
        """字符串字面量。处理前缀（r/b/f 已在 parse 时处理）。"""
        # 判断原始源码前缀以决定转义：ast 无法直接知道前缀，看 node.s 是否含反斜杠
        # 简单：用 JSON.stringify 风格（双引号，转义）。raw string 的反斜杠需保留。
        # Python r"..." 中反斜杠是字面量；ast 已把 r"\n" 解析为 "\\n"（两字符）。
        # JSON.stringify 会把 "\\" 转回 "\\"，正确。
        return json_stringify(s)

    def emit_name(self, node):
        name = node.id
        # 颜色
        if name in GREY_TO_GRAY:
            self.use(GREY_TO_GRAY[name])
            return GREY_TO_GRAY[name]
        if name in COLORS:
            self.use(name)
            return name
        # 方向
        if name in DIRECTIONS:
            self.use(name)
            return name
        # rate func
        if name in RATE_FUNC_RENAME:
            ts = RATE_FUNC_RENAME[name]
            self.use(ts)
            return ts
        # 数学常量
        if name == 'PI':
            return 'Math.PI'
        if name == 'TAU':
            return '2 * Math.PI'
        if name == 'DEGREES':
            return '(Math.PI / 180)'
        if name == 'E':
            return 'Math.E'
        # self -> scene
        if name == 'self':
            return 'scene'
        if name == 'np' or name == 'numpy':
            self.warn(node, "直接引用 numpy 模块；np.X 已逐个处理，整体引用无法转换")
            return '/* np */ undefined'
        if name == 'math':
            return 'Math'
        # True/False/None（ast.Constant 已处理，这里兜底）
        if name == 'True':
            return 'true'
        if name == 'False':
            return 'false'
        if name == 'None':
            return 'null'
        # 类名作为值引用(如 line_func=Line, bounded_graph=curve1)：标记需 import
        if name in CLASS_MAP:
            ts = CLASS_MAP[name]
            self.use(ts)
            return ts
        # 普通变量：snake -> camel
        return snake_to_camel(name)

    def emit_attribute(self, node):
        # self.camera -> scene.camera
        if isinstance(node.value, ast.Name) and node.value.id == 'self':
            if node.attr == 'camera':
                return 'scene.camera'
            # 其它 self.X 属性 -> scene.X（罕见）
            return f"scene.{rename_method(node.attr)}"
        # math.X / np.X
        if isinstance(node.value, ast.Name) and node.value.id == 'math':
            return f"Math.{node.attr}"
        if isinstance(node.value, ast.Name) and node.value.id in ('np', 'numpy'):
            return self.emit_np_attr(node.attr, node)
        # 普通属性：value.attr -> camelCase
        base = self.emit_expr(node.value)
        return f"{base}.{rename_method(node.attr)}"

    def emit_np_attr(self, attr, node):
        # np.X -> np.X；前端 ctx 注入 np polyfill(sin/cos/sqrt/exp/log/pi/e/array/linalg 等)
        return f"np.{attr}"

    # ---------- Call ----------

    def emit_call(self, node):
        func = node.func

        # self.X(...) 场景方法
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id == 'self':
            return self.emit_self_call(func.attr, node)

        # 类实例化：Class(...)
        if isinstance(func, ast.Name) and func.id in CLASS_MAP:
            return self.emit_instantiation(func.id, node)

        # numpy 函数：np.X(...)
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id in ('np', 'numpy'):
            return self.emit_np_call(func.attr, node)

        # math.X(...) -> Math.X(...)
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id == 'math':
            args = ', '.join(self.emit_expr(a) for a in node.args)
            return f"Math.{func.attr}({args})"

        # 内置函数 / 用户自定义函数调用
        if isinstance(func, ast.Name):
            r = self.emit_builtin(func.id, node)
            if r is not None:
                return r
            # 用户自定义函数(嵌套 def 转成 const camelCase = (...) => ...): func(args) -> camelCase(args)
            args = ', '.join(self.emit_expr(a) for a in node.args)
            return f"{snake_to_camel(func.id)}({args})"

        # 方法调用 obj.method(...)
        if isinstance(func, ast.Attribute):
            return self.emit_method_call(func, node)

        # lambda 调用 (lambda x: ...)(args)
        if isinstance(func, ast.Lambda):
            self.warn(node, "立即调用的 lambda 表达式")
            return f"({self.emit_lambda(func)})({', '.join(self.emit_expr(a) for a in node.args)})"

        self.warn(node, f"不支持的调用形式: {ast.dump(node)[:80]}")
        return '/* TODO: 不支持的调用 */'

    def emit_self_call(self, method, node):
        """self.play/wait/add/remove/clear/相机方法/其它。"""
        # play
        if method == 'play':
            return self.emit_play(node)
        # wait
        if method == 'wait':
            args = [self.emit_expr(a) for a in node.args]
            # self.wait(2, frozen_frame=True) 等 kwargs 警告
            if node.keywords:
                self.warn(node, "wait() 的 kwargs 被忽略（ManimWeb wait 仅接受 duration）")
            dur = args[0] if args else '1'
            return f"await scene.wait({dur})"
        # add / remove / clear
        if method == 'add':
            args = [self.emit_expr(a) for a in node.args]
            return f"scene.add({', '.join(args)})"
        if method == 'remove':
            args = [self.emit_expr(a) for a in node.args]
            return f"scene.remove({', '.join(args)})"
        if method == 'clear':
            return "scene.clear()"
        if method == 'play_all':
            args = [self.emit_expr(a) for a in node.args]
            return f"await scene.playAll({', '.join(args)})"
        # 3D 相机方法
        if method == 'set_camera_orientation':
            return self.emit_set_camera_orientation(node)
        if method == 'move_camera':
            return self.emit_move_camera(node)
        if method in SCENE_METHOD_RENAME:
            ts_method = SCENE_METHOD_RENAME[method]
            args = [self.emit_expr(a) for a in node.args]
            # 这些方法的 Python kwarg（rate=, target= 等）在 ManimWeb 是位置参数：
            # beginAmbientCameraRotation(rate), setLookAt(target), addFixedInFrameMobjects(...)
            for kw in node.keywords:
                if kw.arg is None:
                    self.warn(node, f"{method} 的 **kwargs 展开被忽略")
                    continue
                args.append(self.emit_expr(kw.value))
            return f"scene.{ts_method}({', '.join(args)})"

        # 其它 self.X() -> scene.X()，snake->camel
        self.warn(node, f"未识别的 self.{method}()，转为 scene.{rename_method(method)}()")
        args = [self.emit_expr(a) for a in node.args]
        opts = self.build_opts_from_kwargs(node.keywords)
        allargs = args + ([opts] if opts else [])
        return f"scene.{rename_method(method)}({', '.join(allargs)})"

    def emit_play(self, node):
        """self.play(anim1, anim2, run_time=2, rate_func=linear) ->
        await scene.play(<每个 anim 注入 opts>)
        ManimWeb play() 不接受 options，故 run_time/rate_func 注入每个 animation。"""
        play_opts_list = []
        anim_indices = []
        for i, kw in enumerate(node.keywords):
            if kw.arg in PLAY_KWARG_MAP:
                play_opts_list.append((PLAY_KWARG_MAP[kw.arg], self.emit_expr(kw.value)))
            else:
                if kw.arg is None:
                    self.warn(node, "play() 中的 **kwargs 展开：无法注入到各动画，原样追加")
                else:
                    self.warn(node, f"play() 未识别的 kwarg {kw.arg} 被忽略")
        opts_str = ', '.join(f"{k}: {v}" for k, v in play_opts_list)

        # 设置注入上下文，生成各 anim 表达式
        prev = self.current_play_opts
        self.current_play_opts = opts_str if opts_str else None
        anim_args = [self.emit_expr(a) for a in node.args]
        self.current_play_opts = prev

        # 对无法注入的（非 new X(...) 形式）发出警告
        if opts_str:
            for a in anim_args:
                if not (a.startswith('new ') and '(' in a):
                    self.warn(node, f"play 的 run_time/rate_func 无法注入到表达式 '{a[:40]}'；请在该动画实例上直接设置 duration")
                    break

        return f"await scene.play({', '.join(anim_args)})"

    def emit_set_camera_orientation(self, node):
        """self.set_camera_orientation(phi=X, theta=Y, distance=Z) ->
        scene.setCameraOrientation(X, Y, Z)  (位置参数)"""
        vals = {k: None for k in SET_CAMERA_ORIENTATION_ORDER}
        # 位置参数按序填入
        order = SET_CAMERA_ORIENTATION_ORDER
        for i, arg in enumerate(node.args):
            if i < len(order):
                vals[order[i]] = self.emit_expr(arg)
        for kw in node.keywords:
            if kw.arg in vals:
                vals[kw.arg] = self.emit_expr(kw.value)
            elif kw.arg:
                self.warn(node, f"set_camera_orientation 未识别 kwarg {kw.arg}")
        result = [vals[k] for k in order if vals[k] is not None]
        return f"scene.setCameraOrientation({', '.join(result)})"

    def emit_move_camera(self, node):
        """self.move_camera(phi=X, theta=Y, ...) ->
        scene.moveCamera({ phi: X, theta: Y, ... })"""
        opts = []
        # 位置参数（罕见）：按 phi, theta, distance 顺序
        order = ['phi', 'theta', 'distance']
        for i, arg in enumerate(node.args):
            if i < len(order):
                opts.append(f"{order[i]}: {self.emit_expr(arg)}")
        for kw in node.keywords:
            if kw.arg in MOVE_CAMERA_KEYS:
                opts.append(f"{kw.arg}: {self.emit_expr(kw.value)}")
            elif kw.arg == 'run_time':
                opts.append(f"duration: {self.emit_expr(kw.value)}")
            elif kw.arg:
                self.warn(node, f"move_camera 未识别 kwarg {kw.arg}")
        if not opts:
            return "scene.moveCamera({})"
        return f"scene.moveCamera({{ {', '.join(opts)} }})"

    def emit_instantiation(self, cls, node):
        """类实例化：根据构造模式转换。"""
        ts_class = CLASS_MAP[cls]
        self.use(ts_class)

        # varargs 模式（VGroup/Group/AnimationGroup/LaggedStart...）
        if cls in PURE_VARARGS_CLASSES:
            args = [self.emit_expr(a) for a in node.args]
            opts = self.build_opts_from_kwargs(node.keywords)
            # 无 options
            if node.keywords and not opts:
                self.warn(node, f"{cls} 不接受 options，kwargs 被忽略")
            return f"new {ts_class}({', '.join(args)})"
        if cls in VARARGS_OPTS_CLASSES:
            # (...anims, { opts }) -> new Class([...anims], { opts })?
            # ManimWeb AnimationGroup(animations: Animation[], options)
            args = [self.emit_expr(a) for a in node.args]
            opts = self.build_opts_from_kwargs(node.keywords)
            # 注入 play opts
            if self.current_play_opts:
                opts = self._merge_opts(opts, self.current_play_opts)
            arr = '[' + ', '.join(args) + ']'
            if opts:
                return f"new {ts_class}({arr}, {opts})"
            return f"new {ts_class}({arr})"

        # 特殊:mobject 位置参 + 第2参进 options 的某 key(MoveAlongPath.path / ApplyFunction.func)
        POS_TO_OPT = {'MoveAlongPath': 'path', 'ApplyFunction': 'func'}
        if cls in POS_TO_OPT:
            args = [self.emit_expr(a) for a in node.args]
            key = POS_TO_OPT[cls]
            mobject = args[0] if args else 'null'
            parts = []
            if len(args) >= 2:
                parts.append(f"{key}: {args[1]}")
            for kw in node.keywords:
                if kw.arg:
                    parts.append(f"{rename_kwarg(kw.arg)}: {self.emit_expr(kw.value)}")
            opts_str = "{ " + ", ".join(parts) + " }" if parts else "{}"
            if self.current_play_opts:
                opts_str = self._merge_opts(opts_str, self.current_play_opts)
            return f"new {ts_class}({mobject}, {opts_str})"

        # anim 模式：位置参数保留 + kwargs 转 options
        if cls in ANIMATION_CLASSES:
            pos_args = [self.emit_expr(a) for a in node.args]
            opts = self.build_opts_from_kwargs(node.keywords)
            # 注入 play opts
            if self.current_play_opts:
                opts = self._merge_opts(opts, self.current_play_opts)
            if opts:
                return f"new {ts_class}({', '.join(pos_args)}, {opts})"
            if pos_args:
                return f"new {ts_class}({', '.join(pos_args)})"
            return f"new {ts_class}()"

        # options 模式：位置参数映射到 options key + kwargs
        pos_map = CLASS_POSITIONAL.get(cls, [])
        opts_parts = []
        consumed = 0
        # 处理 aggregate key（vertices/latex）
        aggregate_key = None
        for k in pos_map:
            if k in AGGREGATE_KEYS:
                aggregate_key = k
                break

        if aggregate_key:
            # 多位置参数打包成数组；单参数直接用值（latex: "x^2" 而非 ["x^2"]）
            if node.args:
                if len(node.args) == 1:
                    arg = node.args[0]
                    # Polygon(*[...]) / Tex(*parts): Starred 展开即数组本身,vertices/parts 直接用内层表达式
                    inner = arg.value if isinstance(arg, ast.Starred) else arg
                    opts_parts.append(f"{aggregate_key}: {self.emit_expr(inner)}")
                else:
                    arr = '[' + ', '.join(self.emit_expr(a) for a in node.args) + ']'
                    opts_parts.append(f"{aggregate_key}: {arr}")
        else:
            for i, arg in enumerate(node.args):
                if i < len(pos_map):
                    key = pos_map[i]
                    opts_parts.append(f"{key}: {self.emit_expr(arg)}")
                else:
                    self.warn(node, f"{cls} 第 {i+1} 个位置参数无映射，原样放入 options")
                    opts_parts.append(f"arg{i}: {self.emit_expr(arg)}")
        # kwargs
        for kw in node.keywords:
            if kw.arg is None:
                self.warn(node, f"{cls} 实例化中的 **kwargs 展开无法静态转换")
                continue
            key = rename_kwarg(kw.arg)
            opts_parts.append(f"{key}: {self.emit_expr(kw.value)}")

        if opts_parts:
            return f"new {ts_class}({{ {', '.join(opts_parts)} }})"
        return f"new {ts_class}()"

    def _merge_opts(self, existing, inject):
        """合并两个 options 字符串。existing 可能是 None/''。"""
        if not existing:
            return '{ ' + inject + ' }'
        # existing 形如 '{ a: 1 }'
        inner = existing.strip()
        if inner.startswith('{') and inner.endswith('}'):
            inner = inner[1:-1].strip()
            if inner:
                return '{ ' + inner + ', ' + inject + ' }'
            return '{ ' + inject + ' }'
        return '{ ' + inject + ' }'

    def build_opts_from_kwargs(self, keywords):
        """把 keywords 列表转为 '{ key: val, ... }' 字符串（无则返回 ''）。"""
        parts = []
        for kw in keywords:
            if kw.arg is None:
                continue
            key = rename_kwarg(kw.arg)
            parts.append(f"{key}: {self.emit_expr(kw.value)}")
        if not parts:
            return ''
        return '{ ' + ', '.join(parts) + ' }'

    def emit_method_call(self, func, node):
        """obj.method(args, kw=val) -> obj.method(args, { kw: val })"""
        obj = self.emit_expr(func.value)
        method = func.attr

        # .animate 链：obj.animate.X(...) -> obj.animate.X(...)（保留，依赖 AnimateProxy）
        if method == 'animate' and isinstance(func.value, ast.Attribute):
            # 这是 obj.animate 形式被当作 func.value，外层 call 是 .X(...)
            # 实际上 obj.animate.shift(UP) 的 AST:
            #   Call(func=Attribute(value=Call(func=Attribute(value=obj, attr='animate'), args=[]), attr='shift'), args=[UP])
            # 但 obj.animate 本身是 Attribute，不是 Call。修正：obj.animate 是 Attribute(obj, 'animate')
            pass

        # obj.animate 顶层：Attribute(value=obj, attr='animate')
        # 当 func 是 Attribute(value=Attribute(obj,'animate'), attr='X')
        if isinstance(func.value, ast.Attribute) and func.value.attr == 'animate':
            # obj.animate.X(args) -> obj.animate.X(args)  (snake->camel on X)
            ts_method = rename_method(method)
            args = [self.emit_expr(a) for a in node.args]
            opts = self.build_opts_from_kwargs(node.keywords)
            allargs = args + ([opts] if opts else [])
            inner_obj = self.emit_expr(func.value.value)
            # ValueTracker.animate.set_value(v) -> ValueTracker.animateTo(v)
            # manim-web 用 animateTo 动画化 value，AnimateProxy 不暴露 set_value
            if method == 'set_value':
                dur = ", { " + self.current_play_opts + " }" if self.current_play_opts else ""
                return f"{inner_obj}.animateTo({', '.join(allargs)}{dur})"
            # .animate.apply_function(fn) -> new ApplyFunction(obj, {func: fn})
            # AnimateProxy 不支持 applyFunction，用 manim-web 的 ApplyFunction 动画类
            if method == 'apply_function' and args:
                self.use('ApplyFunction')
                return f"new ApplyFunction({inner_obj}, {{ func: {args[0]} }})"
            return f"{inner_obj}.animate.{ts_method}({', '.join(allargs)})"

        ts_method = rename_method(method)
        args = [self.emit_expr(a) for a in node.args]
        opts = self.build_opts_from_kwargs(node.keywords)
        allargs = args + ([opts] if opts else [])
        return f"{obj}.{ts_method}({', '.join(allargs)})"

    def emit_builtin(self, name, node):
        """Python 内置函数转换。返回 None 表示不是内置。"""
        if name == 'range':
            # range(...) 作为值（非 for 循环）-> Array.from
            args = [self.emit_expr(a) for a in node.args]
            if len(args) == 1:
                return f"Array.from({{length: {args[0]}}}, (_, i) => i)"
            if len(args) == 2:
                return f"Array.from({{length: ({args[1]} - {args[0]})}}, (_, i) => i + {args[0]})"
            if len(args) == 3:
                self.warn(node, "range with step 转为手动构建数组")
                return f"/* range step */ Array.from({{length: {args[1]}}}, (_, i) => i)"
        if name == 'len':
            a = self.emit_expr(node.args[0])
            return f"{a}.length"
        if name == 'str':
            a = self.emit_expr(node.args[0])
            return f"String({a})"
        if name == 'int':
            a = self.emit_expr(node.args[0])
            return f"Math.trunc(Number({a}))"
        if name == 'float':
            a = self.emit_expr(node.args[0])
            return f"Number({a})"
        if name == 'bool':
            a = self.emit_expr(node.args[0])
            return f"Boolean({a})"
        if name == 'round':
            return self.emit_round(node)
        if name == 'abs':
            a = self.emit_expr(node.args[0])
            return f"Math.abs({a})"
        if name == 'min':
            args = [self.emit_expr(a) for a in node.args]
            return f"Math.min({', '.join(args)})"
        if name == 'max':
            args = [self.emit_expr(a) for a in node.args]
            return f"Math.max({', '.join(args)})"
        if name == 'sum':
            a = self.emit_expr(node.args[0])
            return f"{a}.reduce((a, b) => a + b, 0)"
        if name == 'sorted':
            a = self.emit_expr(node.args[0])
            return f"[...{a}].sort()"
        if name == 'list':
            a = self.emit_expr(node.args[0])
            return f"[...{a}]"
        if name == 'tuple':
            a = self.emit_expr(node.args[0])
            return f"[...{a}]"
        if name == 'dict':
            return self.emit_dict_from_dict_call(node)
        if name == 'zip':
            args = [self.emit_expr(a) for a in node.args]
            self.warn(node, "zip() 转为手动并行数组；需检查语义")
            return f"/* zip */ [{', '.join(args)}]"
        if name == 'enumerate':
            a = self.emit_expr(node.args[0])
            return f"{a}.entries()"
        if name == 'print':
            args = [self.emit_expr(a) for a in node.args]
            return f"console.log({', '.join(args)})"
        if name == 'isinstance':
            self.warn(node, "isinstance 转为 typeof/instanceof（可能语义不同）")
            a = self.emit_expr(node.args[0])
            return f"/* isinstance */ ({a} !== undefined && {a} !== null)"
        return None  # 非内置

    def emit_round(self, node):
        if not node.args:
            return 'Math.round()'
        x = self.emit_expr(node.args[0])
        if len(node.args) >= 2:
            n = self.emit_expr(node.args[1])
            return f"(Math.round(({x}) * Math.pow(10, {n})) / Math.pow(10, {n}))"
        return f"Math.round({x})"

    def emit_np_call(self, attr, node):
        """np.X(...) -> np.X(...)。前端 ctx 注入 np polyfill 处理(array/arange/linspace/zeros/sin/cos/linalg.norm 等)。"""
        args = [self.emit_expr(a) for a in node.args]
        return f"np.{attr}({', '.join(args)})"

    # ---------- 运算符 ----------

    def emit_binop(self, node):
        op = type(node.op)
        # 向量标量乘法 / 向量加法：必须在 emit 子节点前识别整条链
        if op is ast.Mult:
            v = self._try_vector_mul(node)
            if v is not None:
                return v
        if op is ast.Add:
            v = self._try_vector_add(node)
            if v is not None:
                return v
        left = self.emit_expr(node.left)
        right = self.emit_expr(node.right)
        # 矩阵乘 @
        if op is ast.MatMult:
            self.utilities.add('matMul')
            return f"matMul({left}, {right})"
        # 整除 //
        if op is ast.FloorDiv:
            return f"Math.floor({left} / {right})"
        # 幂 **
        if op is ast.Pow:
            return f"Math.pow({left}, {right})"
        sym = self.binop_str(node.op)
        # 子表达式是 BinOp 时加括号,避免丢优先级((a+b)*(c-d) 错成 a+b*c-d)
        if isinstance(node.left, ast.BinOp):
            left = f"({left})"
        if isinstance(node.right, ast.BinOp):
            right = f"({right})"
        return f"{left} {sym} {right}"

    # 方向向量与复合方向的加法组合 -> 复合常量（ManimWeb 导出 UL/UR/DL/DR）
    VECTOR_ADD_COMBINATIONS = {
        frozenset(['UP', 'LEFT']): 'UL',
        frozenset(['UP', 'RIGHT']): 'UR',
        frozenset(['DOWN', 'LEFT']): 'DL',
        frozenset(['DOWN', 'RIGHT']): 'DR',
    }

    def _try_vector_mul(self, node):
        """DIR * s1 * s2 ... -> scaleVec(s1 * s2, DIR)
           s * DIR          -> scaleVec(s, DIR)
           返回 None 表示不是方向向量乘标量。"""
        if not isinstance(node.op, ast.Mult):
            return None
        # 情况 A：链最左端是方向常量  DIR * s1 * s2
        scalars = []
        cur = node
        while isinstance(cur, ast.BinOp) and isinstance(cur.op, ast.Mult):
            scalars.append(cur.right)
            cur = cur.left
        if isinstance(cur, ast.Name) and cur.id in DIRECTIONS:
            self.use(cur.id)
            self.use('scaleVec')
            scalar_strs = [self.emit_expr(s) for s in reversed(scalars)]
            if len(scalar_strs) == 1:
                return f"scaleVec({scalar_strs[0]}, {cur.id})"
            return f"scaleVec({' * '.join(scalar_strs)}, {cur.id})"
        # 情况 B：右端是方向常量  scalar * DIR
        if isinstance(node.right, ast.Name) and node.right.id in DIRECTIONS \
                and not (isinstance(node.left, ast.Name) and node.left.id in DIRECTIONS):
            self.use(node.right.id)
            self.use('scaleVec')
            return f"scaleVec({self.emit_expr(node.left)}, {node.right.id})"
        return None

    def _try_vector_add(self, node):
        """DIR + DIR -> 复合常量或 addVec(...)；
        向量表达式 + 向量表达式 -> addVec(...)。返回 None 表示非向量加法。"""
        if not isinstance(node.op, ast.Add):
            return None
        # 两个方向常量 -> 复合常量（UL/UR/...）或 addVec
        if isinstance(node.left, ast.Name) and isinstance(node.right, ast.Name) \
                and node.left.id in DIRECTIONS and node.right.id in DIRECTIONS:
            combo = frozenset([node.left.id, node.right.id])
            if combo in self.VECTOR_ADD_COMBINATIONS:
                const = self.VECTOR_ADD_COMBINATIONS[combo]
                self.use(const)
                return const
            self.use('addVec')
            self.use(node.left.id)
            self.use(node.right.id)
            return f"addVec({node.left.id}, {node.right.id})"
        # 任一边是向量表达式（方向常量 / scaleVec / addVec / DIR*scalar）-> addVec
        if self._looks_like_vector(node.left) or self._looks_like_vector(node.right):
            self.use('addVec')
            return f"addVec({self.emit_expr(node.left)}, {self.emit_expr(node.right)})"
        return None

    def _looks_like_vector(self, node):
        """启发式判断 AST 节点是否会产生 Vector3Tuple。"""
        if isinstance(node, ast.Name) and node.id in DIRECTIONS:
            return True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in ('scaleVec', 'addVec'):
            return True
        # DIR * scalar / scalar * DIR -> 向量
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            if isinstance(node.left, ast.Name) and node.left.id in DIRECTIONS:
                return True
            if isinstance(node.right, ast.Name) and node.right.id in DIRECTIONS:
                return True
        return False

    def binop_str(self, op):
        return {
            ast.Add: '+', ast.Sub: '-', ast.Mult: '*', ast.Div: '/',
            ast.Mod: '%', ast.LShift: '<<', ast.RShift: '>>',
            ast.BitOr: '|', ast.BitAnd: '&', ast.BitXor: '^',
        }.get(type(op), '?')

    def emit_unaryop(self, node):
        op = type(node.op)
        if op is ast.Not:
            return f"!({self.emit_expr(node.operand)})"
        # 负数字面量：-3 而非 (-3)
        if op is ast.USub and isinstance(node.operand, ast.Constant) \
                and isinstance(node.operand.value, (int, float)) \
                and not isinstance(node.operand.value, bool):
            return f"-{self.emit_constant(node.operand)}"
        operand = self.emit_expr(node.operand)
        if op is ast.USub:
            return f"(-{operand})"
        if op is ast.UAdd:
            return f"(+{operand})"
        if op is ast.Invert:
            return f"(~{operand})"
        return operand

    def emit_boolop(self, node):
        sym = '&&' if isinstance(node.op, ast.And) else '||'
        parts = [self.emit_expr(v) for v in node.values]
        return f" {sym} ".join(f"({p})" for p in parts)

    def emit_compare(self, node):
        """链式比较 a < b < c -> a < b && b < c（TS 不支持链式）。"""
        left = self.emit_expr(node.left)
        parts = []
        cur = left
        for op, comp in zip(node.ops, node.comparators):
            right = self.emit_expr(comp)
            sym = self.cmp_str(op)
            if isinstance(op, (ast.In, ast.NotIn)):
                self.warn(node, "in/not in 转为 includes()；语义可能不同")
                if isinstance(op, ast.In):
                    parts.append(f"{right}.includes({cur})")
                else:
                    parts.append(f"!{right}.includes({cur})")
            elif isinstance(op, (ast.Is, ast.IsNot)):
                parts.append(f"{cur} {'===' if isinstance(op, ast.Is) else '!=='} {right}")
            else:
                parts.append(f"{cur} {sym} {right}")
            cur = right
        if len(parts) == 1:
            return parts[0]
        return ' && '.join(f"({p})" for p in parts)

    def cmp_str(self, op):
        return {
            ast.Eq: '===', ast.NotEq: '!==',
            ast.Lt: '<', ast.LtE: '<=', ast.Gt: '>', ast.GtE: '>=',
        }.get(type(op), '?')

    # ---------- 容器 ----------

    def emit_dict(self, node):
        parts = []
        for k, v in zip(node.keys, node.values):
            if k is None:
                # **spread
                parts.append('...' + self.emit_expr(v))
            else:
                ks = self.emit_dict_key(k)
                vs = self.emit_expr(v)
                parts.append(f"{ks}: {vs}")
        return '{ ' + ', '.join(parts) + ' }'

    def emit_dict_key(self, k):
        if isinstance(k, ast.Constant) and isinstance(k.value, str):
            # snake_case 字符串 key -> camelCase 属性名（ManimWeb options）
            return rename_kwarg(k.value) if _is_ident(k.value) else json_stringify(k.value)
        return self.emit_expr(k)

    def emit_dict_from_dict_call(self, node):
        return self.emit_dict(ast.Dict(keys=[], values=[]))  # dict() -> {}

    def emit_dictcomp(self, node):
        self.warn(node, "字典推导式转为 Object.fromEntries；复杂场景需手动检查")
        if len(node.generators) == 1 and not node.generators[0].ifs:
            tgt = self.emit_target(node.generators[0].target, declare=True)
            it = self.emit_expr(node.generators[0].iter)
            key = self.emit_expr(node.key)
            val = self.emit_expr(node.value)
            return f"Object.fromEntries({it}.map(({tgt}) => [{key}, {val}]))"
        self.warn(node, "复杂字典推导式转为 TODO")
        return "/* TODO: dict comp */ {}"

    def emit_lambda(self, node):
        params = self.emit_params(node.args)
        body = self.emit_expr(node.body)
        return f"({params}) => {body}"

    def emit_listcomp(self, node):
        """[expr for x in iter if cond] -> iter.filter(...).map(...)"""
        if len(node.generators) != 1:
            self.warn(node, "多生成器推导式转为嵌套 flatMap；请检查结果")
            return self._emit_multi_comp(node)
        gen = node.generators[0]
        tgt = self.emit_target(gen.target, declare=True)
        it = self.emit_expr(gen.iter)
        elt = self.emit_expr(node.elt)
        expr = it
        for cond in gen.ifs:
            expr = f"{expr}.filter(({tgt}) => {self.emit_expr(cond)})"
        expr = f"{expr}.map(({tgt}) => {elt})"
        return expr

    def _emit_multi_comp(self, node):
        # [elt for x in a for y in b] -> a.flatMap(x => b.map(y => elt))
        gen0 = node.generators[0]
        tgt0 = self.emit_target(gen0.target, declare=True)
        it0 = self.emit_expr(gen0.iter)
        inner = self.emit_expr(node.elt)
        for gen in reversed(node.generators[1:]):
            tgt = self.emit_target(gen.target, declare=True)
            it = self.emit_expr(gen.iter)
            inner = f"{it}.map(({tgt}) => {inner})"
            for cond in gen.ifs:
                inner = f"/* if */ {inner}"
        return f"{it0}.flatMap(({tgt0}) => {inner})"

    def emit_subscript(self, node):
        base = self.emit_expr(node.value)
        sl = node.slice
        # 切片 a[1:3] -> a.slice(1, 3)
        if isinstance(sl, ast.Slice):
            return base + self.emit_slice(sl)
        # 普通 a[i] -> a[i]；a[-1] -> a[a.length-1]
        if isinstance(sl, ast.Index):  # py<3.9 兼容
            sl = sl.value
        if isinstance(sl, ast.UnaryOp) and isinstance(sl.op, ast.USub) and isinstance(sl.operand, ast.Constant):
            idx = self.emit_expr(sl)
            return f"{base}[{base}.length - {self.emit_expr(sl.operand)}]"
        return f"{base}[{self.emit_expr(sl)}]"

    def emit_subscript_slice(self, sl):
        # 用于赋值左侧
        if isinstance(sl, ast.Slice):
            return self.emit_slice(sl)
        if isinstance(sl, ast.Index):
            sl = sl.value
        return f"[{self.emit_expr(sl)}]"

    def emit_slice(self, sl):
        # a[start:stop:step]
        lower = self.emit_expr(sl.lower) if sl.lower is not None else '0'
        if sl.step is not None:
            self.warn(sl, "带步长的切片无法直接转换，转为 filter/手动循环")
        if sl.upper is not None:
            return f".slice({lower}, {self.emit_expr(sl.upper)})"
        return f".slice({lower})"

    def emit_fstring(self, node):
        """f-string -> 模板字符串 `...${expr}...`"""
        out = ['`']
        for val in node.values:
            if isinstance(val, ast.Constant):
                out.append(val.value.replace('`', '\\`').replace('${', '\\${'))
            elif isinstance(val, ast.FormattedValue):
                if val.format_spec:
                    self.warn(val, "f-string format spec 被忽略（TS 模板字符串不支持）")
                out.append('${' + self.emit_expr(val.value) + '}')
            else:
                out.append('${' + self.emit_expr(val) + '}')
        out.append('`')
        return ''.join(out)

    # ---------- 参数 ----------

    def emit_params(self, args):
        """函数参数列表（TS，无类型注解，统一 any）。"""
        parts = []
        # 普通参数
        for a in args.args:
            nm = snake_to_camel(a.arg)
            if a.arg == 'self':
                continue
            if args.defaults and len(args.args) - args.args.index(a) <= len(args.defaults):
                # 有默认值
                di = len(args.defaults) - (len(args.args) - args.args.index(a))
                parts.append(f"{nm} = {self.emit_expr(args.defaults[di])}")
            else:
                parts.append(nm)
        # *args -> ...args: any[]
        if args.vararg:
            parts.append('...' + snake_to_camel(args.vararg.arg))
        # **kwargs -> ...kwargs: any[] (近似)
        if args.kwarg:
            self.warn(args, "**kwargs 参数转为对象展开；TS 需手动标注类型")
            parts.append('...Object.values(' + snake_to_camel(args.kwarg.arg) + ' ?? {})')
        return ', '.join(p for p in parts)

    # ============================================================
    # 输出组装
    # ============================================================

    def build_output(self, scenes):
        lines = []
        lines.append('// 由 py2ts.py 从 Python Manim 自动转换 (AST-based)')
        lines.append('// 转换是近似的，请检查结果。3D 类参数名与 .animate 行为需重点核对。')
        if self.warnings:
            lines.append(f'// ⚠ 转换产生 {len(self.warnings)} 条警告，见 stderr。')
        lines.append('')

        # import
        imports = sorted(self.imports)
        if imports:
            lines.append("import {")
            lines.append('  ' + ',\n  '.join(imports))
            lines.append("} from 'manim-web';")
            lines.append('')

        # utility 提示
        if self.utilities:
            lines.append(f"// TODO: 以下 utility 函数需自行实现或从工具库导入: {', '.join(sorted(self.utilities))}")
            lines.append('')

        # 各 scene 函数
        for sc in scenes:
            if sc.get('scene_type') is None:
                # 顶层函数
                params = sc.get('params', '')
                lines.append(f"export function {sc['func_name']}({params}) {{")
            else:
                lines.append(f"export async function {sc['func_name']}(scene: {sc['scene_type']}) {{")
            for bl in sc['body']:
                lines.append(bl)
            lines.append('}')
            lines.append('')

        return '\n'.join(lines)


# ============================================================
# 4. 辅助
# ============================================================

def _is_ident(s):
    """是否合法标识符（用于决定 dict key 是否加引号）。"""
    if not s:
        return False
    if not (s[0].isalpha() or s[0] == '_' or s[0] == '$'):
        return False
    return all(c.isalnum() or c in '_$' for c in s[1:])


def json_stringify(s):
    """Python str -> TS 字符串字面量（双引号，转义）。保留字面反斜杠。"""
    out = ['"']
    for ch in s:
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif ch == '\n':
            out.append('\\n')
        elif ch == '\r':
            out.append('\\r')
        elif ch == '\t':
            out.append('\\t')
        elif ord(ch) < 0x20:
            out.append(f'\\u{ord(ch):04x}')
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


# ============================================================
# 5. 主转换入口
# ============================================================

def convert(source, filename='<input>'):
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as e:
        sys.stderr.write(f"语法错误: {e}\n")
        sys.exit(1)
    gen = Gen()
    output = gen.convert_module(tree)
    # 输出警告到 stderr
    for line, msg in gen.warnings:
        sys.stderr.write(f"  ⚠ 行 {line}: {msg}\n")
    return output, gen.warnings


# ============================================================
# 6. CLI
# ============================================================

def main():
    ap = argparse.ArgumentParser(
        prog='py2ts',
        description='Convert Python Manim scripts to ManimWeb TypeScript (AST-based).',
    )
    ap.add_argument('input', nargs='?', help='输入 .py 文件（省略则读 stdin）')
    ap.add_argument('-o', '--output', help='输出 .ts 文件（省略则写 stdout）')
    ap.add_argument('--test', action='store_true', help='运行内置测试用例')
    args = ap.parse_args()

    if args.test:
        run_test()
        return

    if args.input:
        try:
            with open(args.input, 'r', encoding='utf-8') as f:
                source = f.read()
        except OSError as e:
            sys.stderr.write(f"无法读取 {args.input}: {e}\n")
            sys.exit(1)
    else:
        source = sys.stdin.read()

    output, warnings = convert(source, args.input or '<stdin>')

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        sys.stderr.write(f"已写入 {args.output}\n")
    else:
        sys.stdout.write(output)

    if warnings:
        sys.exit(2)


def run_test():
    """内置测试：覆盖 2D、3D、kwargs、play 注入、lambda、列表推导、f-string。"""
    test_py = '''from manim import *
import numpy as np

class SquareToCircle(Scene):
    def construct(self):
        circle = Circle(radius=2, color=RED, fill_opacity=0.5)
        square = Square(side_length=2)
        square.rotate(PI / 4)

        self.play(Create(square), run_time=1.5)
        self.play(Transform(square, circle), rate_func=smooth)
        self.play(FadeOut(square))
        self.wait(2)


class MathScene(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-3, 3, 1],
            y_range=[-2, 2, 1],
            x_length=8,
            axis_config={"include_numbers": True},
        )
        graph = axes.get_graph(lambda x: x ** 2, color=BLUE)
        label = MathTex(r"x^2", font_size=48)

        self.play(Create(axes))
        self.play(Create(graph), Write(label))
        self.wait()

        # 列表推导
        dots = VGroup(*[Dot(radius=0.1, color=YELLOW).shift(RIGHT * i * 0.5) for i in range(10)])
        self.play(LaggedStart(*[FadeIn(d, shift=UP * 0.3) for d in dots], lag_ratio=0.1))


class ThreeDScene(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=PI / 3, theta=PI / 4)

        axes = ThreeDAxes(
            x_range=[-4, 4, 1],
            y_range=[-4, 4, 1],
            z_range=[-3, 3, 1],
        )
        sphere = Sphere(radius=1.5, color=BLUE)
        cube = Cube(side_length=1, color=GREEN)
        cone = Cone(radius=1, height=2, color=RED)
        arrow = Arrow3D(start=[0, 0, 0], end=[2, 1, 1], color=YELLOW)

        # 参数曲面
        surface = Surface(
            lambda u, v: [u, v, np.sin(u) * np.cos(v)],
            u_range=[-3, 3],
            v_range=[-3, 3],
            color=PURPLE,
        )

        self.add(axes, sphere, cube, cone, arrow, surface)
        self.play(Create(arrow), run_time=2)

        self.move_camera(phi=PI / 2, theta=PI / 2, run_time=3)
        self.begin_ambient_camera_rotation(rate=0.1)
        self.wait(4)
        self.stop_ambient_camera_rotation()

        # 固定在屏幕上的文字
        title = Text("3D Surface", font_size=36, color=WHITE)
        self.add_fixed_in_frame_mobjects(title)
'''
    print("═══ Python 输入 ═══")
    print(test_py)
    print("\n═══ TypeScript 输出 ═══")
    out, warns = convert(test_py, '<test>')
    print(out)
    if warns:
        print(f"\n═══ {len(warns)} 条警告 ═══")


if __name__ == '__main__':
    main()
