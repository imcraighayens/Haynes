'use client'
import { useApp } from '@/contexts/AppContext'
import StatusBar from '@/components/ui/StatusBar'

export default function UploadScreen() {
  const { goto, showToast, uploadedDocs, markDoc } = useApp()

  const docs = [
    { id: 'statement', icon: '🏦', title: '3-Month Bank Statement', desc: 'PDF or image, last 3 months required' },
    { id: 'payslip', icon: '💼', title: 'Proof of Income / Payslip', desc: 'Most recent payslip or income proof' },
    { id: 'id', icon: '🪪', title: 'South African ID Document', desc: 'Clear photo of ID book or smart card' },
  ]

  const uploadedCount = Object.keys(uploadedDocs).filter(k => uploadedDocs[k]).length
  const allDone = uploadedCount === docs.length

  const handleUpload = (docId: string) => {
    markDoc(docId)
    showToast('Document uploaded ✓')
  }

  const handleSubmit = () => {
    if (!allDone) {
      showToast('Please upload all 3 documents')
      return
    }
    showToast('Documents submitted for review')
    setTimeout(() => goto('assessment'), 800)
  }

  return (
    <>
      <StatusBar />
      <div className="scroll-area">
        <div className="upload-inner">
          <button className="back-btn" onClick={() => goto('login')}>
            <svg viewBox="0 0 18 18"><path d="M11 14L6 9l5-5" /></svg>
            Back
          </button>

          <div className="upload-title">Upload Documents</div>
          <div className="upload-sub">Step 2 of 4 — Verify your identity</div>

          <div className="step-track">
            <div className="step-seg done" />
            <div className="step-seg active" />
            <div className="step-seg" />
            <div className="step-seg" />
          </div>

          <div className="info-banner">
            🔒 Your documents are encrypted and processed securely. We use AI to verify your income and creditworthiness instantly.
          </div>

          {docs.map(doc => (
            <div
              key={doc.id}
              className={`upload-zone${uploadedDocs[doc.id] ? ' done' : ''}`}
              onClick={() => !uploadedDocs[doc.id] && handleUpload(doc.id)}
            >
              <div className="upload-icon">{doc.icon}</div>
              <div className="upload-info">
                <h4>{doc.title}</h4>
                <p>{uploadedDocs[doc.id] ? 'Uploaded successfully' : doc.desc}</p>
              </div>
              <span className="upload-check">✅</span>
            </div>
          ))}

          <button
            className={`btn${allDone ? ' btn-yellow' : ' btn-ghost'}`}
            style={{ marginTop: 24 }}
            onClick={handleSubmit}
          >
            {allDone ? 'Submit Documents →' : `Upload all documents (${uploadedCount}/3)`}
          </button>
        </div>
      </div>
    </>
  )
}
