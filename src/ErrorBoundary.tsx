import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * 顶层错误边界:渲染/生命周期异常不再让整页白屏(之前无边界时,任何渲染期 TypeError
 * 如 ParamSliders.toFixed(undefined) 会把整个应用打成空白)。出错时给一个可恢复的面板:
 * 显示错误、可"重新加载",而不是白屏。同时把错误打到 console 便于排查。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // 记录到 console(避免错误被边界吞掉无从排查)
    console.error("[ErrorBoundary]", error, info);
  }

  handleReload = () => {
    // 出错后整页重载通常能恢复(清掉坏了的内存态);React 19 的 onCaughtError 也会打日志
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="grid place-items-center h-screen w-screen bg-[var(--bg-deepest)] text-[var(--text)]">
          <div className="max-w-md mx-auto p-6 text-center">
            <div className="text-[40px] mb-3">⚠️</div>
            <div className="text-[15px] font-medium mb-2">页面渲染出错了</div>
            <div className="text-[11px] text-[var(--text-mute)] mb-4 break-all">
              {String(this.state.error.message || this.state.error)}
            </div>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-md bg-[var(--blue)] text-[var(--bg-deepest)] text-[12px] font-medium hover:bg-[var(--blue-strong)]"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}