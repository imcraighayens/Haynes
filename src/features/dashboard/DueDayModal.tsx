import { Modal } from '../../ui/Modal'

export function DueDayModal(props: { date: string; onClose: () => void }) {
  return <Modal title="DueDayModal" onClose={props.onClose}>Coming soon</Modal>
}
