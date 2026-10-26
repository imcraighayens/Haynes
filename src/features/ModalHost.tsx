import { createPortal } from 'react-dom'
import { useUi, type ModalSpec } from '../store/ui'
import { ConfirmModal } from '../ui/ConfirmModal'
import { ClientHub } from './clients/ClientHub'
import { ClientFormModal } from './clients/ClientForm'
import { ContractModal } from './clients/ContractModal'
import { NewLoanWizard } from './loans/NewLoanWizard'
import { LoanDetail } from './loans/LoanDetail'
import { LoanEditModal } from './loans/LoanEditModal'
import { LoanStatusModal } from './loans/LoanStatusModal'
import { SettlementLetter } from './loans/SettlementLetter'
import { PaidUpLetter } from './loans/PaidUpLetter'
import { BulkUpload } from './loans/BulkUpload'
import { NotificationsModal } from './notifications/NotificationsModal'
import { DueDayModal } from './dashboard/DueDayModal'
import { LogPettyModal } from './petty/LogPettyModal'
import { ReconModal } from './ledger/ReconModal'
import { ApplicationModal } from './applications/ApplicationModal'

function render(m: ModalSpec, close: () => void) {
  switch (m.kind) {
    case 'client': return <ClientHub clientId={m.clientId} tab={m.tab} onClose={close} />
    case 'clientForm': return <ClientFormModal clientId={m.clientId} section={m.section} onClose={close} />
    case 'contract': return <ContractModal clientId={m.clientId} onClose={close} />
    case 'newLoan': return <NewLoanWizard clientId={m.clientId} applicationId={m.applicationId} onClose={close} />
    case 'loan': return <LoanDetail loanId={m.loanId} onClose={close} />
    case 'loanEdit': return <LoanEditModal loanId={m.loanId} onClose={close} />
    case 'loanStatus': return <LoanStatusModal loanId={m.loanId} onClose={close} />
    case 'settlement': return <SettlementLetter loanId={m.loanId} onClose={close} />
    case 'paidUp': return <PaidUpLetter loanId={m.loanId} onClose={close} />
    case 'bulkUpload': return <BulkUpload onClose={close} />
    case 'notifications': return <NotificationsModal onClose={close} />
    case 'dueDay': return <DueDayModal date={m.date} onClose={close} />
    case 'petty': return <LogPettyModal onClose={close} />
    case 'recon': return <ReconModal onClose={close} />
    case 'application': return <ApplicationModal applicationId={m.applicationId} onClose={close} />
    case 'confirm':
      return <ConfirmModal title={m.title} body={m.body} confirmLabel={m.confirmLabel} danger={m.danger} requireText={m.requireText} reasonLabel={m.reasonLabel} onConfirm={m.onConfirm} onClose={close} />
  }
}

/** Renders the modal stack; only the top one is interactive. */
export function ModalHost() {
  const { stack, close } = useUi()
  // Portalled to <body> so no transformed ancestor can become the containing block for the fixed scrim.
  return createPortal(
    <>
      {stack.map((m, i) => (
        <div key={i} style={{ display: i === stack.length - 1 ? 'contents' : 'none' }}>
          {render(m, close)}
        </div>
      ))}
    </>,
    document.body,
  )
}
