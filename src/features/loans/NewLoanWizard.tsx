import { Modal } from '../../ui/Modal'

export function NewLoanWizard(props: { clientId?: string; applicationId?: string; onClose: () => void }) {
  return <Modal title="NewLoanWizard" onClose={props.onClose}>Coming soon</Modal>
}
