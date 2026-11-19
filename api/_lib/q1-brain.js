// Deterministic Q1 replies. No model, no gateway key. Figures that arrived in the
// console's DATA block are quoted as sent. Live rows only fill gaps (applications,
// name search) and never override a balance or due-list the console already computed.
import { isSafeId } from './validate.js';
import { scrubSecrets } from './q1-webhook.js';

const NAV = [
  ['newloan', /new loan|issue a loan|create a loan/, 'New loan'],
  ['expenses', /expenses?/, 'Open expenses'],
  ['employees', /employees?|staff\b/, 'Open employees'],
  ['logbook', /log\s?book|audit/, 'Open logbook'],
  ['settings', /settings?/, 'Open settings'],
  ['notifications', /notifications?/, 'Open notifications'],
  ['applications', /applications?/, 'Review applications'],
  ['clients', /clients?\b/, 'Open clients'],
  ['loans', /\bloans?\b/, 'Open loans'],
  ['bank', /\bbank\b/, 'Open bank'],
  ['ledger', /\bledger\b|\badmin\b/, 'Open ledger'],
  ['dashboard', /dashboard|\bhome\b/, 'Open dashboard']
];

const STOP = new Set('what whats due today bank book loan loans client clients show open status balance overdue paid issued summarise summarize summary the who hasn hasnt been updated update application applications quik1 approve approved decline declined reject help please from with this that about into your you for and are is was not any new how many much in on to go take me'.split(/\s+/));

export function rand(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'R 0';
  const neg = v < 0;
  const a = Math.abs(v);
  const whole = Math.floor(a + 1e-9);
  const cents = Math.round((a - whole) * 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-R ' : 'R ') + grouped + (cents ? '.' + String(cents).padStart(2, '0') : '');
}

function field(text, label) {
  const re = new RegExp('^' + label + ':\\s*(.*)$', 'im');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : null;
}

function tidy(reply) {
  return scrubSecrets(String(reply || ''))
    .replace(/\{\{|\}\}/g, '')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, 1800);
}

function action(go, label) {
  return { go, label };
}

export function parseLedgerData(text) {
  const src = String(text || '');
  const loans = [];
  const splitAt = src.search(/\nLOANS\b/i);
  const head = splitAt >= 0 ? src.slice(0, splitAt) : src;
  const tail = splitAt >= 0 ? src.slice(splitAt) : '';
  const block = tail.split(/\n{2,}|CONNECTED APPS/i)[0] || '';
  for (const raw of block.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('###')) break;
    const parts = line.split(/\s+\|\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,40}$/.test(parts[0])) continue;
    if (!parts.some(p => /^status\s+\S/i.test(p))) continue;
    const who = parts[1] || '';
    const statusPart = parts.find(p => /^status\s+/i.test(p)) || '';
    loans.push({
      ref: parts[0],
      client: who.replace(/\s*\([^)]*\)\s*$/, '').trim() || '—',
      clientRef: (who.match(/\(([A-Za-z0-9-]+)/) || [])[1] || '',
      blocked: /BLOCKED/i.test(who),
      lent: (parts.find(p => /^lent\s+/i.test(p)) || '').replace(/^lent\s+/i, ''),
      instalment: (parts.find(p => /return per instalment/i.test(p)) || '').replace(/^return per instalment\s+/i, ''),
      status: statusPart.replace(/^status\s+/i, '').trim(),
      dates: (parts.find(p => /^dates\s+/i.test(p)) || '').replace(/^dates\s+/i, '')
    });
  }
  const clients = field(head, 'CLIENTS');
  return {
    today: field(head, 'TODAY'),
    user: field(head, 'USER'),
    page: field(head, 'CURRENT PAGE'),
    bank: field(head, 'BANK BALANCE'),
    duePresent: field(head, 'DUE TODAY') != null,
    due: field(head, 'DUE TODAY') || '',
    flaggedPresent: /^FLAGGED\b/im.test(head),
    flagged: (field(head, 'FLAGGED \\(past due, status not updated\\)') || field(head, 'FLAGGED') || ''),
    expenses: field(head, 'MONTHLY OFFICE EXPENSES'),
    employees: field(head, 'EMPLOYEES'),
    clientCount: clients != null && /^\d+/.test(clients) ? parseInt(clients, 10) : null,
    loans
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function ymd(value) {
  const s = String(value || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/.exec(s);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
}

export function todayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function liveDue(loans, today) {
  const due = [];
  const flagged = [];
  for (const l of loans || []) {
    const dates = Array.isArray(l.schedule) ? l.schedule : [];
    const skip = Number(l.paid) || 0;
    const next = dates[skip] || dates[0];
    const day = ymd(next);
    if (!day) continue;
    const label = `${l.ref} ${l.instalment ? rand(l.instalment) : rand(l.principal)}`;
    if (day === today && l.status !== 'paid' && l.status !== 'written_off' && l.status !== 'settled_early') due.push(label.trim());
    if (day < today && (l.status === 'issued' || l.status === 'overdue' || l.status === 'duetoday')) flagged.push(`${l.ref} due ${next}`);
  }
  return { due: due.join('; '), flagged: flagged.join('; ') };
}

export function mergeBook(parsed, live, now = new Date()) {
  const p = parsed || parseLedgerData('');
  const loans = p.loans && p.loans.length ? p.loans : ((live && live.loans) || []);
  const computed = (!p.duePresent || !p.flaggedPresent) && live ? liveDue(live.loans, todayYmd(now)) : { due: '', flagged: '' };
  const bankFromConsole = p.bank != null && p.bank !== '' && !/not set/i.test(p.bank);
  return {
    today: p.today || '',
    user: p.user || '',
    page: p.page || '',
    bank: bankFromConsole ? p.bank : (live && live.bank != null ? rand(live.bank) : (p.bank || 'not set')),
    due: p.duePresent ? p.due : computed.due,
    flagged: p.flaggedPresent ? p.flagged : computed.flagged,
    expenses: p.expenses || ((live && live.expenses) || []).map(e => `${e.name} ${rand(e.amount)}`).join('; '),
    employees: p.employees || ((live && live.employees) || []).map(e => `${e.name} (${e.role || ''})`).join('; '),
    clientCount: p.clientCount != null ? p.clientCount : ((live && live.clients) ? live.clients.length : null),
    loans,
    clients: (live && live.clients) || [],
    applications: (live && live.applications) || [],
    apps: [],
    appsNote: ''
  };
}

function splitList(s) {
  return String(s || '').split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
}

function bullet(items) {
  return items.map(x => '• ' + x).join('\n');
}

function countStatus(loans) {
  const n = {};
  for (const l of loans || []) {
    const s = String(l.status || 'open').toLowerCase() || 'open';
    n[s] = (n[s] || 0) + 1;
  }
  return n;
}

function findPeople(snap, message) {
  const low = message.toLowerCase();
  const hits = [];
  const seen = new Set();
  const push = (row) => {
    const key = (row.ref || '') + '|' + (row.client || row.name || '');
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(row);
  };
  for (const l of snap.loans || []) {
    const name = String(l.client || '');
    const ref = String(l.ref || '');
    if (ref && low.includes(ref.toLowerCase())) push(l);
    else if (nameMentions(name, low) || (l.clientRef && low.includes(String(l.clientRef).toLowerCase()))) push(l);
  }
  for (const c of snap.clients || []) {
    if (!nameMentions(c.name, low) && !(c.ref && low.includes(String(c.ref).toLowerCase()))) continue;
    const already = hits.some(h => h.client && c.name && h.client.toLowerCase() === String(c.name).toLowerCase());
    if (!already) push({ ref: c.ref || '—', client: c.name, status: c.blocked ? 'blocked' : 'no open loan in this list', lent: '' });
  }
  return hits.slice(0, 6);
}

function nameMentions(name, low) {
  const parts = String(name || '').toLowerCase().split(/\s+/).filter(p => p.length >= 4 && !STOP.has(p));
  if (!parts.length) return false;
  return parts.some(p => low.includes(p));
}

function findApplication(snap, message) {
  const low = message.toLowerCase();
  const rows = snap.applications || [];
  const byId = rows.filter(a => a.id && low.includes(String(a.id).toLowerCase()));
  if (byId.length === 1) return { one: byId[0], many: [] };
  const byRef = rows.filter(a => a.ref && low.includes(String(a.ref).toLowerCase()));
  if (byRef.length === 1) return { one: byRef[0], many: [] };
  const byName = rows.filter(a => nameMentions(a.name, low));
  if (byName.length === 1) return { one: byName[0], many: [] };
  return { one: null, many: byName };
}

function quik1App(snap) {
  return (snap.apps || []).find(a => /quik1/i.test(a.name || ''));
}

function proposeDecision(snap, message) {
  const approve = /\bapprov/i.test(message);
  const decline = /\b(declin|reject)/i.test(message);
  if (!approve && !decline) return null;
  const status = decline && !approve ? 'declined' : 'approved';
  const app = quik1App(snap);
  const found = findApplication(snap, message);
  if (!found.one) {
    const pending = (snap.applications || []).filter(a => a.status === 'new' || a.status === 'reviewing').slice(0, 6);
    const list = pending.length
      ? '\n' + bullet(pending.map(a => `${a.name || '—'} · ${a.ref || a.id} · ${rand(a.amount)} · ${a.status}`))
      : '';
    return {
      reply: (found.many.length > 1
        ? 'More than one application matches. Name the person or the reference, then I can propose the decision.'
        : 'I cannot see a single application to ' + status + '.' + (pending.length ? ' These still need a decision:' : ' Nothing new is waiting.')) + list,
      action: action('applications', 'Review applications'),
      call: null
    };
  }
  if (!app || !app.actions) {
    return {
      reply: `${found.one.name || 'That application'} (${found.one.ref || found.one.id}, ${rand(found.one.amount)}, ${found.one.status}) is on the book. Actions are off for the Quik1 app, so I will not send ${status}. Turn actions on under Ledger › Q1 connected apps, then ask again.`,
      action: action('applications', 'Review applications'),
      call: null
    };
  }
  if (!isSafeId(String(found.one.id || ''))) {
    return {
      reply: `I can see ${found.one.name || 'that application'} but not a safe id to send. Open it in Applications and decide there.`,
      action: action('applications', 'Review applications'),
      call: null
    };
  }
  const word = status === 'approved' ? 'approved' : 'declined';
  return {
    reply: `I can tell Quik1 that ${found.one.name || 'this application'} (${found.one.ref || found.one.id}, ${rand(found.one.amount)}) is ${word}. Nothing is sent until you confirm.`,
    action: null,
    call: {
      app: app.name,
      method: 'PATCH',
      path: '/applications/' + found.one.id,
      body: { status },
      label: 'Send ' + word + ' to Quik1'
    }
  };
}

function lookupReply(hits) {
  const lines = hits.map(h => {
    const bits = [h.ref, h.client || h.name || '—'];
    if (h.lent) bits.push('lent ' + h.lent);
    if (h.instalment) bits.push(h.instalment);
    if (h.status) bits.push(h.status);
    if (h.blocked) bits.push('BLOCKED');
    if (h.dates) bits.push(h.dates);
    return bits.filter(Boolean).join(' · ');
  });
  return bullet(lines);
}

export function answerQuestion(message, snap, history = [], now = new Date()) {
  const q = String(message || '').trim();
  const low = q.toLowerCase();
  const prior = (Array.isArray(history) ? history : []).slice(-4).map(h => String((h && (h.text || h.content)) || '')).join('\n');
  const widened = /\b(her|him|them|that one|this one)\b/i.test(q) ? q + '\n' + prior : q;
  const book = snap || mergeBook(null, null, now);
  const due = splitList(book.due);
  const flagged = splitList(book.flagged);
  const loans = book.loans || [];

  const command = /^(please\s+)?(open|go to|take me to|navigate to|show me the)\b/i.test(q);
  if (command) {
    if (/\bdue today\b|\bwhat's due\b|\bwhats due\b/.test(low)) {
      /* fall through to the due answer and its filter button */
    } else if (/\boverdue\b|\bnot been updated\b|\bhasn'?t been updated\b/.test(low)) {
      /* fall through */
    } else {
      for (const [go, re, label] of NAV) {
        if (re.test(low)) return { reply: tidy(label + '.'), action: action(go, label), call: null };
      }
      if (/paid/.test(low)) return { reply: tidy('Here are the paid loans.'), action: action('filter:paid', 'Show paid'), call: null };
      if (/issued/.test(low)) return { reply: tidy('Here are the issued loans.'), action: action('filter:issued', 'Show issued'), call: null };
    }
  }

  const wantsDecision = /\b(approve|decline|reject)\b/i.test(low)
    || /\b(mark|set|send)\b[^.]*\b(approved|declined)\b/i.test(low);
  if (wantsDecision) {
    const decision = proposeDecision(book, widened);
    if (decision) return { ...decision, reply: tidy(decision.reply) };
  }

  if (/hasn'?t been updated|not been updated|not updated|flagged|past due/.test(low)) {
    if (!flagged.length) {
      return { reply: tidy('Nothing is flagged. Every past due date I can see has a status, or nothing is past due.'), action: action('notifications', 'Open notifications'), call: null };
    }
    return {
      reply: tidy('These are past due and the status has not been updated:\n' + bullet(flagged.slice(0, 8)) + (flagged.length > 8 ? `\n• and ${flagged.length - 8} more` : '')),
      action: action('notifications', 'Update statuses'),
      call: null
    };
  }

  if (/\boverdue\b/.test(low)) {
    const rows = loans.filter(l => String(l.status || '').toLowerCase() === 'overdue');
    const list = rows.length ? rows.map(l => `${l.ref} · ${l.client || '—'} · ${l.lent || l.status}`) : flagged;
    if (!list.length) return { reply: tidy('No loan is marked overdue.'), action: action('filter:overdue', 'Show overdue'), call: null };
    return { reply: tidy(list.length + ' overdue:\n' + bullet(list.slice(0, 8))), action: action('filter:overdue', 'Show overdue'), call: null };
  }

  if (/due today|what'?s due|whats due|\bdue\b/.test(low) && !/overdue/.test(low)) {
    if (!due.length) return { reply: tidy('Nothing is due today.'), action: action('filter:duetoday', 'Show due today'), call: null };
    return { reply: tidy('Due today:\n' + bullet(due.slice(0, 8)) + (due.length > 8 ? `\n• and ${due.length - 8} more` : '')), action: action('filter:duetoday', 'Show due today'), call: null };
  }

  if (/bank|what'?s in the bank|whats in the bank|balance/.test(low) && !/client/.test(low)) {
    const bal = book.bank && !/not set/i.test(book.bank) ? book.bank : 'not set';
    return { reply: tidy(bal === 'not set' ? 'The bank balance is not set yet. Open the bank card and confirm it.' : 'The bank balance is ' + bal + '.'), action: action('bank', 'Open bank'), call: null };
  }

  if (/application/.test(low)) {
    const rows = (book.applications || []).slice(0, 8);
    const fresh = rows.filter(a => a.status === 'new');
    if (!rows.length) return { reply: tidy('No applications are on the live list.'), action: action('applications', 'Review applications'), call: null };
    const show = (fresh.length ? fresh : rows).slice(0, 6);
    return {
      reply: tidy((fresh.length ? fresh.length + ' new application' + (fresh.length === 1 ? '' : 's') : rows.length + ' application' + (rows.length === 1 ? '' : 's')) + ':\n' + bullet(show.map(a => `${a.name || '—'} · ${a.ref || a.id} · ${rand(a.amount)} · ${a.status}`))),
      action: action('applications', 'Review applications'),
      call: null
    };
  }

  if (/expense|rent|salar/.test(low) && book.expenses) {
    return { reply: tidy('Monthly office expenses: ' + book.expenses + '.'), action: action('expenses', 'Open expenses'), call: null };
  }

  if (/employee|who works|staff\b/.test(low) && book.employees) {
    return { reply: tidy('Employees: ' + book.employees + '.'), action: action('employees', 'Open employees'), call: null };
  }

  if (/summar|overview|the book|how many|portfolio|what'?s on/.test(low)) {
    const n = countStatus(loans);
    const bits = Object.keys(n).map(k => n[k] + ' ' + k);
    const clients = book.clientCount != null ? book.clientCount + ' clients' : null;
    const parts = [
      (loans.length ? loans.length + ' loan' + (loans.length === 1 ? '' : 's') : 'No loans in this view') + (bits.length ? ' (' + bits.join(', ') + ')' : ''),
      clients,
      book.bank ? 'bank ' + book.bank : null,
      due.length ? due.length + ' due today' : 'nothing due today',
      flagged.length ? flagged.length + ' flagged' : null
    ].filter(Boolean);
    return { reply: tidy(parts.join('. ') + '.'), action: action('dashboard', 'Open dashboard'), call: null };
  }

  const hits = findPeople(book, widened);
  if (hits.length && (/who is|look up|find\b|search|tell me about|show\b/.test(low) || /\b(ecl-|ec-|ap-)\d*/i.test(q) || nameMentions(hits[0].client, low))) {
    return { reply: tidy(lookupReply(hits)), action: action('loans', 'Open loans'), call: null };
  }

  if (/connected app|which apps|quik1 link/.test(low)) {
    const apps = book.apps || [];
    if (!apps.length) return { reply: tidy('No connected apps are switched on. Link them under Ledger › Q1 connected apps.'), action: action('ledger', 'Open ledger'), call: null };
    return {
      reply: tidy('Switched on:\n' + bullet(apps.map(a => a.name + (a.actions ? ' (actions allowed)' : ' (read only)')))),
      action: action('ledger', 'Open ledger'),
      call: null
    };
  }

  if (book.appsNote && /quik1|nupay|connected/.test(low)) {
    const note = scrubSecrets(book.appsNote).slice(0, 500);
    if (note) return { reply: tidy(note), action: action('applications', 'Review applications'), call: null };
  }

  if (/where am i|this screen|this page|what page/.test(low)) {
    const page = book.page || 'the console';
    return { reply: tidy('You are on ' + page + '. Ask what is due, who is overdue, or say open loans.'), action: null, call: null };
  }

  if (/help|what can you|how do i/.test(low)) {
    return {
      reply: tidy('I read the live book. Ask what is due today, who has not been updated, the bank balance, or for a summary. Say "open loans" to jump there. If Quik1 actions are on, I can propose an approve or decline, and you confirm before anything is sent.'),
      action: action('dashboard', 'Open dashboard'),
      call: null
    };
  }

  const page = book.page ? ' You are on ' + book.page + '.' : '';
  return {
    reply: tidy('I can answer from the book.' + page + ' Try "what is due today", "who has not been updated", "what is in the bank", or "summarise the book".'),
    action: action('dashboard', 'Open dashboard'),
    call: null
  };
}

const BORROWER_GO = new Set(['home', 'accounts', 'credit', 'performance', 'schedule', 'statements', 'documents', 'support', 'tracker', 'activity', 'loan', 'amount']);

function briefField(brief, label) {
  const m = String(brief || '').match(new RegExp('^' + label + ':\\s*(.*)$', 'im'));
  return m ? m[1].trim() : '';
}

export function answerBorrower(message, brief, extra = '') {
  const q = String(message || '').trim();
  const low = q.toLowerCase();
  const balance = briefField(brief, 'Outstanding balance \\(principal \\+ charge\\)') || briefField(brief, 'Outstanding balance');
  const due = briefField(brief, 'Next debit date');
  const bank = briefField(brief, 'Payout account');
  const limit = briefField(brief, 'Credit limit');
  const charge = briefField(brief, 'Flat charge');
  const drawn = briefField(brief, 'Amount drawn');
  const status = String(extra || '').trim();
  let go = null;
  let reply;

  if (/^(open|show|go to|take me to)\b/.test(low)) {
    if (/statement/.test(low)) go = 'statements';
    else if (/repay|schedule|debit/.test(low)) go = 'schedule';
    else if (/document/.test(low)) go = 'documents';
    else if (/help|person|support/.test(low)) go = 'support';
    else if (/home/.test(low)) go = 'home';
    else if (/account/.test(low)) go = 'accounts';
    else if (/reward|performance/.test(low)) go = 'performance';
    else if (/track|application|status/.test(low)) go = 'tracker';
    else if (/loan|limit|credit/.test(low)) go = 'credit';
  }

  if (/owe|outstanding|balance|what do i owe/.test(low)) {
    reply = balance
      ? 'Your outstanding balance is ' + balance + '.' + (charge ? ' The flat charge is ' + charge + '.' : '')
      : 'I do not have an outstanding balance on this screen yet.';
  } else if (/settle|early|penalty/.test(low)) {
    reply = 'Yes. Settling early costs nothing extra. You pay the balance shown and the loan closes the same day.';
  } else if (/limit|increase|more credit|bigger/.test(low)) {
    reply = limit
      ? 'Your limit is ' + limit + '. It grows once the interest you have paid reaches your original loan amount.'
      : 'I do not have a credit limit on this screen yet.';
  } else if (/charge|interest|rate|fee/.test(low)) {
    reply = charge
      ? 'One flat charge of ' + charge + '. No monthly fees and no initiation fee.'
      : 'Quik1 charges one flat percentage of the amount you draw. No monthly fees and no initiation fee.';
  } else if (/debit|due date|next debit|when is/.test(low)) {
    reply = due
      ? 'Your next debit is ' + due + (bank ? ', collected from ' + bank : '') + '.'
      : 'I do not have a debit date on this screen yet.';
  } else if (/statement/.test(low)) {
    reply = 'Statements lists each month. Open it to view or download one.';
  } else if (/document|payslip|upload/.test(low)) {
    reply = 'Documents keeps your agreement and uploads.';
  } else if (/help|person|human|agent|call/.test(low)) {
    reply = 'Help reaches a person between 08:00 and 18:00.';
  } else if (/status|application|approved|declined|tracker/.test(low)) {
    reply = status
      ? status.replace(/^Application status:\s*/i, 'Your application is ') + '.'
      : 'Open the tracker to see where the application is, from submitted to paid out.';
  } else if (/drawn|how much did i/.test(low) && drawn) {
    reply = 'The amount drawn is ' + drawn + '.';
  } else if (go) {
    reply = 'Opening that screen.';
  } else {
    reply = 'I can help with your balance, your debit date, settling early, and your limit. Help reaches a person between 08:00 and 18:00.';
  }

  if (go && !BORROWER_GO.has(go)) go = null;
  return { reply: tidy(reply), go };
}
