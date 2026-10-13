// Hosts a DCLogic instance and renders the compiled template against
// { ...props, ...logic.renderVals() } — the same contract as the design runtime.
import React from 'react';
import type { DCLogic } from './DCLogic';

type Props = {
  Logic: new (props: any) => DCLogic;
  render: (vals: Record<string, any>) => React.ReactNode;
  props: Record<string, any>;
  name?: string;
};

export class DCHost extends React.Component<Props, { v: number; err: string | null }> {
  logic: DCLogic;
  state = { v: 0, err: null as string | null };

  constructor(p: Props) {
    super(p);
    this.logic = new p.Logic(p.props);
    this.logic.__host = this;
  }

  __setLogicState(update: unknown, cb?: () => void) {
    const prev = this.logic.state;
    const patch = typeof update === 'function' ? (update as (s: unknown) => object)(prev) : update;
    this.logic.state = { ...prev, ...(patch as object) };
    this.setState((s) => ({ v: s.v + 1 }), cb);
  }

  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error('[quik1] render error', e);
  }
  componentDidMount() {
    try { this.logic.componentDidMount(); } catch (e) { console.error(e); }
  }
  componentDidUpdate(prevProps: Props) {
    this.logic.props = this.props.props;
    try { this.logic.componentDidUpdate(prevProps.props); } catch (e) { console.error(e); }
  }
  componentWillUnmount() {
    try { this.logic.componentWillUnmount(); } catch (e) { console.error(e); }
  }

  render() {
    this.logic.props = this.props.props;
    let vals = this.props.props;
    let err = this.state.err;
    try {
      vals = { ...this.props.props, ...(this.logic.renderVals() || {}) };
    } catch (e) {
      console.error(e);
      err = 'renderVals(): ' + (e instanceof Error ? e.message : String(e));
    }
    return (
      <div className={'sc-host' + (err ? ' sc-has-error' : '')} data-sc-name={this.props.name || 'Root'}>
        {err && <div className="sc-logic-error">{err}</div>}
        {!this.state.err && this.props.render(vals)}
      </div>
    );
  }
}
