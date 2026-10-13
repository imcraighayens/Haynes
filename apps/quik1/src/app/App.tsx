import { DCHost } from '../runtime/DCHost';
import { renderTemplate } from '../generated/template';
import Quik1Logic from '../generated/logic';
import { designDefaults } from './props';

const props = designDefaults();

// ?parity=1 exposes the host so scripts/parity.mjs can drive the app into a
// given screen state and compare it with the delivered prototype.
const parity = typeof location !== 'undefined' && new URLSearchParams(location.search).has('parity');

export function App() {
  return (
    <DCHost
      ref={parity ? (h) => ((window as unknown as { __quik1Host?: DCHost | null }).__quik1Host = h) : undefined}
      Logic={Quik1Logic}
      render={renderTemplate}
      props={props}
    />
  );
}
