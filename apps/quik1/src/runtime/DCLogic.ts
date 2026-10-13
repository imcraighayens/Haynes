// Base class the design's logic was written against (the runtime's DCLogic /
// StreamableLogic). State lives on the logic instance; the host component
// re-renders when it changes.
export type Host = { __setLogicState(update: unknown, cb?: () => void): void; forceUpdate(): void };

export class DCLogic<P = Record<string, any>, S = Record<string, any>> {
  props: P;
  state: S = {} as S;
  __host?: Host;
  constructor(props?: P) {
    this.props = (props || {}) as P;
  }
  setState(update: Partial<S> | ((s: S) => Partial<S>), cb?: () => void) {
    this.__host && this.__host.__setLogicState(update, cb);
  }
  forceUpdate() {
    this.__host && this.__host.forceUpdate();
  }
  componentDidMount() {}
  componentDidUpdate(_prevProps?: P, _prevState?: S) {}
  componentWillUnmount() {}
  /** The flat object the template renders against (merged over props). */
  renderVals(): Record<string, any> {
    return {};
  }
}
