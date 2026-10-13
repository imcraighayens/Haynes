// Quik1 back office: staff review sign-ups and referred applications, see the
// loan book, answer Help chats and (admins) read the audit log. Every write is
// a staff_* database function that re-checks the caller's role.
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { sb } from '../app/supabase';
import { LIVE } from '../app/env';
import './admin.css';

type Row = Record<string, any>;
const R = (cents: number | null | undefined) => 'R ' + Math.round((cents ?? 0) / 100).toLocaleString('en-ZA').replace(/,/g, ' ');
const when = (ts: string) => new Date(ts).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });

function useRows(load: () => PromiseLike<{ data: Row[] | null; error: any }>, deps: unknown[] = []) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const { data, error } = await load();
    setError(error ? error.message : '');
    setRows(data ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, error, reload };
}

async function act(fn: () => PromiseLike<{ error: any }>, done: () => void) {
  const { error } = await fn();
  if (error) alert(error.message);
  else done();
}

// ── screens ──────────────────────────────────────────────────────────────────
function Signups() {
  const { rows, error, reload } = useRows(() => sb().from('customers').select('*').eq('status', 'pending_review').order('created_at'));
  return (
    <Section title="Sign-ups waiting for review" error={error} empty={!rows.length && 'No sign-ups waiting.'}>
      <table>
        <thead><tr><th>Ref</th><th>Name</th><th>ID number</th><th>Mobile</th><th>Work</th><th>Take-home</th><th>Submitted</th><th /></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.ref}</td><td>{c.full_name}</td><td className="mono">{c.id_number}</td><td>{c.phone}</td>
              <td>{c.employment ?? '—'} · {c.employer ?? '—'}</td><td>{R(c.income_cents)}</td><td>{when(c.created_at)}</td>
              <td className="actions">
                <button className="yes" onClick={() => act(() => sb().rpc('staff_review_customer', { p_customer_id: c.id, p_approve: true, p_note: 'Identity checked' }), reload)}>Approve</button>
                <button onClick={() => { const note = prompt('Reason for declining (kept on file):'); if (note) void act(() => sb().rpc('staff_review_customer', { p_customer_id: c.id, p_approve: false, p_note: note }), reload); }}>Decline</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Applications() {
  const { rows, error, reload } = useRows(() => sb().from('applications').select('*, customers(full_name, ref)').order('created_at', { ascending: false }).limit(200));
  return (
    <Section title="Applications" error={error} empty={!rows.length && 'No applications yet.'}>
      <table>
        <thead><tr><th>Ref</th><th>Customer</th><th>Amount</th><th>Term</th><th>Purpose</th><th>Affordability</th><th>Flags</th><th>Status</th><th>Offer</th><th /></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={a.status === 'referred' ? 'attention' : ''}>
              <td>{a.ref}</td><td>{a.customers?.full_name}</td><td>{R(a.amount_cents)}</td><td>{a.term_months} mo</td><td>{a.purpose}</td>
              <td>{a.affordability ?? '—'}%</td><td className="small">{(a.flags ?? []).join('; ') || '—'}</td>
              <td><span className={'pill ' + a.status}>{a.status}</span></td><td>{a.offer_cents ? R(a.offer_cents) : '—'}</td>
              <td className="actions">
                {a.status === 'referred' && (
                  <>
                    <button className="yes" onClick={() => {
                      const v = prompt('Offer amount in rand (R500–R8 000):', String(Math.round(a.amount_cents / 100)));
                      if (v) void act(() => sb().rpc('staff_decide_application', { p_application_id: a.id, p_approve: true, p_offer_cents: Math.round(Number(v) * 100) }), reload);
                    }}>Approve…</button>
                    <button onClick={() => act(() => sb().rpc('staff_decide_application', { p_application_id: a.id, p_approve: false }), reload)}>Decline</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Loans() {
  const { rows, error } = useRows(() => sb().from('loans').select('*, customers(full_name), drawdowns(principal_cents, signed_at, payouts(status))').order('created_at', { ascending: false }).limit(500));
  const active = rows.filter((l) => l.status === 'active');
  return (
    <Section title="Loan book" error={error} empty={!rows.length && 'No loans yet.'}>
      <div className="kpis">
        <Kpi label="Active loans" value={String(active.length)} />
        <Kpi label="Principal out" value={R(active.reduce((s, l) => s + l.principal_cents, 0))} />
        <Kpi label="Owed incl. charges" value={R(active.reduce((s, l) => s + l.total_cents, 0))} />
        <Kpi label="Settled" value={String(rows.filter((l) => l.status === 'settled').length)} />
      </div>
      <table>
        <thead><tr><th>Ref</th><th>Customer</th><th>Principal</th><th>Charge</th><th>Total</th><th>Term</th><th>Due</th><th>Payout</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.ref}</td><td>{l.customers?.full_name}</td><td>{R(l.principal_cents)}</td><td>{R(l.charge_cents)}</td><td>{R(l.total_cents)}</td>
              <td>{l.term_months} mo</td><td>{l.first_due_date}</td>
              <td className="small">{(l.drawdowns ?? []).map((d: Row) => d.payouts?.[0]?.status ?? '—').join(', ')}</td>
              <td><span className={'pill ' + l.status}>{l.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Help() {
  const { rows, error, reload } = useRows(() => sb().from('support_messages').select('*, customers(full_name, ref)').order('created_at', { ascending: false }).limit(500));
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const threads = new Map<string, Row[]>();
  for (const m of [...rows].reverse()) threads.set(m.customer_id, [...(threads.get(m.customer_id) ?? []), m]);
  const list = [...threads.entries()].sort((a, b) => b[1][b[1].length - 1].created_at.localeCompare(a[1][a[1].length - 1].created_at));
  const current = open ? threads.get(open) ?? [] : [];
  return (
    <Section title="Help inbox" error={error} empty={!rows.length && 'No messages yet.'}>
      <div className="inbox">
        <ul>
          {list.map(([cid, msgs]) => {
            const last = msgs[msgs.length - 1];
            return (
              <li key={cid} className={open === cid ? 'on' : ''} onClick={() => setOpen(cid)}>
                <b>{last.customers?.full_name}</b>
                <span className={last.sender === 'customer' ? 'waiting' : ''}>{last.sender === 'customer' ? 'Waiting · ' : ''}{last.body.slice(0, 60)}</span>
              </li>
            );
          })}
        </ul>
        <div className="thread">
          {current.map((m) => <p key={m.id} className={m.sender}>{m.body}<small>{when(m.created_at)}</small></p>)}
          {open && (
            <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void act(() => sb().rpc('staff_reply', { p_customer_id: open, p_body: draft.trim() }), () => { setDraft(''); void reload(); }); }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply as Quik1 Help" />
              <button className="yes">Send</button>
            </form>
          )}
        </div>
      </div>
    </Section>
  );
}

function Audit() {
  const { rows, error } = useRows(() => sb().from('audit_log').select('*').order('at', { ascending: false }).limit(300));
  return (
    <Section title="Audit log (append-only)" error={error} empty={!rows.length && 'Nothing logged yet.'}>
      <table>
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>ID</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td className="mono small">{r.actor ?? 'system'}</td><td>{r.action}</td><td>{r.entity}</td><td className="mono small">{r.entity_id}</td></tr>)}</tbody>
      </table>
    </Section>
  );
}

// ── shell ────────────────────────────────────────────────────────────────────
function Section({ title, error, empty, children }: { title: string; error: string; empty: string | false; children: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {error ? <p className="error">{error}</p> : empty ? <p className="empty">{empty}</p> : children}
    </section>
  );
}
const Kpi = ({ label, value }: { label: string; value: string }) => <div className="kpi"><span>{label}</span><b>{value}</b></div>;

const TABS = { signups: ['Sign-ups', Signups], applications: ['Applications', Applications], loans: ['Loan book', Loans], help: ['Help inbox', Help], audit: ['Audit log', Audit] } as const;

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <form className="login" onSubmit={async (e) => {
      e.preventDefault();
      const { error } = await sb().auth.signInWithPassword({ email, password });
      setError(error ? 'Sign-in failed. Check your email and password.' : '');
    }}>
      <img src="/assets/img/quik1-wordmark.png" alt="Quik1" />
      <h1>Back office</h1>
      <input type="email" autoComplete="username" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="error">{error}</p>}
      <button className="yes">Sign in</button>
    </form>
  );
}

function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Row | null | undefined>(undefined);
  const [tab, setTab] = useState<keyof typeof TABS>('signups');
  useEffect(() => {
    void sb().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setStaff(undefined); return; }
    void sb().from('staff').select('*').eq('user_id', session.user.id).eq('active', true).maybeSingle().then(({ data }) => setStaff(data));
  }, [session]);

  if (!LIVE) return <p className="empty pad">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use the back office.</p>;
  if (!session) return <Login />;
  if (staff === undefined) return null;
  if (!staff) return <p className="empty pad">This account is not on the staff list. <button onClick={() => sb().auth.signOut()}>Sign out</button></p>;
  const Screen = TABS[tab][1];
  return (
    <div className="shell">
      <nav>
        <img src="/assets/img/quik1-wordmark.png" alt="Quik1" />
        {(Object.keys(TABS) as (keyof typeof TABS)[]).filter((k) => k !== 'audit' || staff.role === 'admin').map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{TABS[k][0]}</button>
        ))}
        <div className="me">{staff.name} · {staff.role}<button onClick={() => sb().auth.signOut()}>Sign out</button></div>
      </nav>
      <main><Screen /></main>
    </div>
  );
}

createRoot(document.getElementById('admin-root')!).render(<Admin />);
