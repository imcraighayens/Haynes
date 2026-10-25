import { Modal } from '../../ui/Modal'
import type { ClientTab } from '../../store/ui'

export function ClientHub(props: { clientId: string; tab?: ClientTab; onClose: () => void }) {
  return <Modal title="ClientHub" onClose={props.onClose}>Coming soon</Modal>
}
