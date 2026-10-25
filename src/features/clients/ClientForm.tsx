import { Modal } from '../../ui/Modal'
import type { ClientTab } from '../../store/ui'

export function ClientFormModal(props: { clientId?: string; section?: ClientTab; onClose: () => void }) {
  return <Modal title="ClientFormModal" onClose={props.onClose}>Coming soon</Modal>
}
