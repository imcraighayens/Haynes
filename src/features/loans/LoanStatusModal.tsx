import { Modal } from '../../ui/Modal'

export function LoanStatusModal(props: { loanId: string; onClose: () => void }) {
  return <Modal title="LoanStatusModal" onClose={props.onClose}>Coming soon</Modal>
}
