import { Modal } from '../../ui/Modal'

export function ApplicationModal(props: { applicationId?: string; onClose: () => void }) {
  return <Modal title="ApplicationModal" onClose={props.onClose}>Coming soon</Modal>
}
