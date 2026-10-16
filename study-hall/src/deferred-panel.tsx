import {
  createElement,
  lazy,
  Suspense,
  Component,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react";
class PanelBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="panel">
        <p>화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>
        <button onClick={() => location.reload()}>새로고침</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function deferredPanel<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
) {
  const Panel = lazy(load);
  return function DeferredPanel(props: ComponentProps<T>) {
    return (
      <PanelBoundary>
        <Suspense fallback={<p role="status">화면을 불러오는 중입니다.</p>}>
          {createElement(Panel, props)}
        </Suspense>
      </PanelBoundary>
    );
  };
}
