import { useState } from 'react'
import { PlusCircle, UserPlus, Banknote } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { LoanTable } from '../components/loans/LoanTable'
import { NewLoanModal } from '../components/modals/NewLoanModal'
import { AddClientModal } from '../components/modals/AddClientModal'
import { LogPettyCashModal } from '../components/modals/LogPettyCashModal'

export function Loans() {
  const [newLoan, setNewLoan] = useState(false)
  const [addClient, setAddClient] = useState(false)
  const [pettyCash, setPettyCash] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Loan Management</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track, filter and manage every loan in your book.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Banknote size={16} />} onClick={() => setPettyCash(true)}>
            Log Petty Cash
          </Button>
          <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => setAddClient(true)}>
            Add Client
          </Button>
          <Button icon={<PlusCircle size={16} />} onClick={() => setNewLoan(true)}>
            New Loan
          </Button>
        </div>
      </div>

      <Card className="p-5">
        <LoanTable />
      </Card>

      <NewLoanModal open={newLoan} onClose={() => setNewLoan(false)} />
      <AddClientModal open={addClient} onClose={() => setAddClient(false)} />
      <LogPettyCashModal open={pettyCash} onClose={() => setPettyCash(false)} />
    </div>
  )
}
