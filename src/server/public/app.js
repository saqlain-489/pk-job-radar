const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const api = (p, opts) => fetch(p, opts).then((r) => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const ICON = {
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  brief: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

const store = {
  get: (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const state = { jobs: [], lastWatch: null, newSince: null, quiet: false, companies: [], outreach: [], runs: [], summary: null };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const scoreColor = (s) => (s >= 75 ? 'var(--s-high)' : s >= 60 ? 'var(--s-mid)' : s >= 40 ? 'var(--s-low)' : 'var(--s-none)');
const pkr = (n) => (n >= 100000 ? `${(n / 100000).toFixed(n % 100000 ? 1 : 0)} lac` : `${Math.round(n / 1000)}k`);
const DAY = 86400000;
const SOURCE_LABEL = { site: 'from company website', jobboard: 'from job-board feed', rozee: 'from Rozee.pk' };
const parseDay = (s) => (s ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s) : NaN);
const ageDays = (j) => {
  const t = parseDay(j.posted_at);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / DAY)) : null;
};
const BAD_FLAGS = new Set(['stale post (30+ days)', 'below pay floor', 'unpaid', 'service bond', 'outside Pakistan', '5+ years', 'women only', 'men only']);

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#themeBtn').innerHTML = `<svg class="i" viewBox="0 0 24 24">${t === 'dark' ? ICON.sun : ICON.moon}</svg>`;
}
applyTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set('theme', t);
  applyTheme(t);
});

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  store.set('tab', name);
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab(store.get('tab', 'jobs'));

/* ---------- summary / funnel ---------- */
function renderSummary() {
  const { funnel: f, last_watch: w, pending } = state.summary;
  $('#lastRun').textContent = w ? `Last check ${ago(w.started_at)} · ${f.open_eng_jobs} open engineering jobs at ${f.with_live_eng_jobs} companies` : 'No watch run yet: run "check jobs"';
  const steps = [
    ['Maps results', f.maps_results],
    ['Software companies', f.companies, `${f.noise_filtered} noise filtered`],
    ['With website', f.with_website, `${f.discovered} discovered · ${f.real_software} confirmed`],
    ['Careers page / ATS', f.with_careers_or_ats],
    ['Live eng. jobs', f.with_live_eng_jobs, `${f.open_eng_jobs} jobs · ${f.rozee_jobs} from Rozee`],
    [`Matches ${state.summary.threshold}+`, f.matches_60, `${f.companies_with_match} companies`, 'hl'],
    ['Cold-email list', f.cold_email, null, 'cold'],
  ];
  const max = Math.max(1, f.maps_results);
  $('#funnel').innerHTML = steps
    .map(([l, n, sub, cls]) => {
      const pct = Math.max(2, Math.round((Math.log10((n || 0) + 1) / Math.log10(max + 1)) * 100));
      return `<div class="step ${cls || ''}" title="${esc(sub || '')}"><div class="n">${(n || 0).toLocaleString()}</div><div class="l">${esc(l)}${sub ? `<br><span class="muted">${esc(sub)}</span>` : ''}</div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    })
    .join('');
  $('#pending').innerHTML = pending.length
    ? `<div class="pending">${icon('alert')}<div><b>Waiting for Claude:</b> ${pending.map((p) => `${esc(p.kind)} packet <code>${esc(p.file)}</code>`).join(', ')}. Say "check jobs" in a Claude session in this folder to finish it.</div></div>`
    : '';
}

/* ---------- jobs ---------- */
function jobFilters() {
  const f = new FormData($('#jobFilters'));
  return {
    q: (f.get('q') || '').toLowerCase().trim(),
    loc: f.get('loc'),
    status: f.get('status'),
    city: f.get('city'),
    minScore: Number(f.get('minScore')),
    eng: f.get('eng') === 'on',
    closed: f.get('closed') === 'on',
    maxAge: Number(f.get('maxAge')),
    source: f.get('source') || 'all',
    sort: f.get('sort') || 'score',
    undated: f.get('undated') === 'on',
  };
}

function matches(j, f) {
  if (!f.closed && j.closed_at) return false;
  if (f.eng && !j.engineering) return false;
  if (j.score < f.minScore) return false;
  if (f.source !== 'all' && j.source !== f.source) return false;
  const age = ageDays(j);
  if (age === null ? !f.undated : f.maxAge && age > f.maxAge) return false;
  if (f.loc !== 'all' && (j.location_type || 'onsite') !== f.loc) return false;
  if (f.city !== 'all' && (j.city || j.company?.city) !== f.city) return false;
  if (f.status === 'active' ? !['new', 'saved'].includes(j.status) : f.status !== 'all' && j.status !== f.status) return false;
  if (f.q) {
    const hay = `${j.title} ${j.company?.name} ${j.skills.join(' ')} ${j.description || ''}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

function expText(j) {
  if (j.experience_min == null) return null;
  const r = j.experience_max != null && j.experience_max !== j.experience_min ? `${j.experience_min}–${j.experience_max}` : `${j.experience_min}${j.experience_max == null ? '+' : ''}`;
  return `${r} yrs${j.experience_inferred ? ' (title)' : ''}`;
}

function jobCard(j) {
  const c = j.company || {};
  const chips = [];
  const lt = j.location_type;
  chips.push(`<span class="chip ${lt ? `loc-${lt}` : ''}">${icon('pin')}${esc(lt ? lt[0].toUpperCase() + lt.slice(1) : 'On-site?')}${j.city ? ` · ${esc(j.city[0].toUpperCase() + j.city.slice(1))}` : ''}</span>`);
  const age = ageDays(j);
  const ageTxt = age === null ? 'date unknown' : `${j.posted_source === 'first_seen' ? 'appeared' : 'posted'} ${age === 0 ? 'today' : `${age}d ago`}`;
  chips.push(`<span class="chip ${age === null ? '' : age <= 3 ? 'loc-remote' : age <= 7 ? 'warn' : 'bad'}" title="${esc(j.posted_at || 'no post date on the page')}">${icon('clock')}${esc(ageTxt)}</span>`);
  const closes = parseDay(j.closes_at);
  const today = new Date().toISOString().slice(0, 10);
  if (Number.isFinite(closes) && (closes >= Date.now() || String(j.closes_at).slice(0, 10) === today)) {
    const left = Math.max(0, Math.ceil((closes - Date.now()) / DAY));
    chips.push(`<span class="chip ${left <= 3 ? 'bad' : 'info'}" title="Deadline ${esc(j.closes_at)}">${icon('alert')}${left === 0 ? 'closes today' : `closes in ${left}d`}</span>`);
  }
  const e = expText(j);
  if (e) chips.push(`<span class="chip">${icon('brief')}${esc(e)}</span>`);
  if (j.salary_max != null) chips.push(`<span class="chip ${j.salary_max < 100000 ? 'bad' : 'loc-remote'}">${icon('wallet')}PKR ${pkr(j.salary_min)}${j.salary_max !== j.salary_min ? `–${pkr(j.salary_max)}` : ''}</span>`);
  if (j.employment_type && j.employment_type !== 'full-time') chips.push(`<span class="chip">${icon('brief')}${esc(j.employment_type)}</span>`);
  if (j.apply_method === 'email' || j.apply_method === 'whatsapp') chips.push(`<span class="chip info">${icon(j.apply_method === 'email' ? 'mail' : 'phone')}${esc(j.apply_contact || j.apply_method)}</span>`);
  for (const fl of j.flags) chips.push(`<span class="chip ${BAD_FLAGS.has(fl) ? 'bad' : 'warn'}">${icon('alert')}${esc(fl)}</span>`);
  const meta = [c.kind && c.kind !== 'unclear' ? c.kind : null, c.size && c.size !== 'unknown' ? `${c.size} people` : null, c.foreign_clients ? 'foreign clients' : null].filter(Boolean);
  const btn = (s, ic, label) => `<button type="button" data-s="${s}" aria-pressed="${j.status === s}" aria-label="${label}" title="${label}">${icon(ic)}</button>`;
  return `<article class="job ${j.closed_at ? 'closed' : ''} is-${esc(j.status)}" data-id="${esc(j.id)}">
    <div class="ring" style="--v:${j.score};--c:${scoreColor(j.score)}" aria-label="Score ${j.score} of 100"><span>${j.score}</span></div>
    <div class="job-main">
      <div class="job-title"><a href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.title)}</a>${j.is_new ? '<span class="badge">New</span>' : ''}${j.closed_at ? '<span class="badge closed">Closed</span>' : ''}</div>
      <div class="co"><a href="${safeUrl(c.website)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>${meta.map((m) => `<span class="dot">${esc(m)}</span>`).join('')}<span class="dot muted">${esc(SOURCE_LABEL[j.source] || '')}</span><span class="dot muted">seen ${ago(j.first_seen)}</span></div>
      <div class="chips">${chips.join('')}</div>
      <ul class="reasons">${j.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
    <div class="actions">
      <div class="status-seg" role="group" aria-label="Set status">${btn('saved', 'bookmark', 'Save')}${btn('applied', 'check', 'Mark applied')}${btn('skipped', 'x', 'Skip')}</div>
      <a class="btn sm" href="${safeUrl(j.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open job post">${icon('ext')}<span>Open post</span></a>
    </div>
  </article>`;
}

function renderJobs() {
  const f = jobFilters();
  $('#minScoreOut').textContent = f.minScore;
  store.set('jobFilters', { ...f, q: '' });
  const time = (x) => (Number.isFinite(parseDay(x)) ? parseDay(x) : null);
  const sorters = {
    score: (a, b) => b.score - a.score,
    newest: (a, b) => (time(b.posted_at) ?? Date.parse(b.first_seen)) - (time(a.posted_at) ?? Date.parse(a.first_seen)),
    closing: (a, b) => (time(a.closes_at) ?? Infinity) - (time(b.closes_at) ?? Infinity) || b.score - a.score,
  };
  const list = state.jobs.filter((j) => matches(j, f)).sort(sorters[f.sort] || sorters.score);
  const fresh = list.filter((j) => j.is_new);
  $('#newSection').innerHTML = fresh.length
    ? `<div class="list-head new-head"><h2>${state.quiet ? 'Newest finds' : 'New since last run'}</h2><span class="muted">${fresh.length} job${fresh.length > 1 ? 's' : ''} · first seen ${ago(state.newSince)}${state.quiet ? ` · the last check (${ago(state.lastWatch)}) found nothing new` : ''}</span></div><div class="cards">${fresh.map(jobCard).join('')}</div>`
    : state.lastWatch
      ? `<div class="list-head new-head quiet"><h2>New since last run</h2><span class="muted">nothing new in the last check (${ago(state.lastWatch)})</span></div>`
      : '';
  const rest = list.filter((j) => !j.is_new);
  $('#jobCount').textContent = `${rest.length} shown of ${state.jobs.filter((j) => !j.closed_at).length} open`;
  $('#jobList').innerHTML = rest.length
    ? rest.map(jobCard).join('')
    : `<div class="empty">${fresh.length ? 'Everything that matches is in the section above.' : 'No jobs match these filters. Lower the min score or switch status to "All".'}</div>`;
  $('#cJobs').textContent = state.jobs.filter((j) => !j.closed_at && j.engineering && j.score >= 60).length || '';
}

function restoreJobFilters() {
  const saved = store.get('jobFilters', null);
  const cities = [...new Set(state.jobs.map((j) => j.city || j.company?.city).filter(Boolean))].sort();
  $('#jobFilters [name=city]').innerHTML = `<option value="all">All</option>${cities.map((c) => `<option value="${esc(c)}">${esc(c[0].toUpperCase() + c.slice(1))}</option>`).join('')}`;
  if (!saved) return;
  const form = $('#jobFilters');
  form.loc.value = saved.loc || 'all';
  form.status.value = saved.status || 'active';
  form.city.value = cities.includes(saved.city) ? saved.city : 'all';
  form.minScore.value = saved.minScore ?? 40;
  form.eng.checked = saved.eng !== false;
  form.closed.checked = !!saved.closed;
  form.maxAge.value = String(saved.maxAge ?? 7);
  form.source.value = saved.source || 'all';
  form.sort.value = saved.sort || 'score';
  form.undated.checked = saved.undated !== false;
}

$('#jobFilters').addEventListener('input', renderJobs);
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('.status-seg button');
  if (!b) return;
  const card = b.closest('.job');
  const job = state.jobs.find((x) => x.id === card.dataset.id);
  const next = job.status === b.dataset.s ? 'new' : b.dataset.s;
  b.disabled = true;
  const r = await post(`/api/jobs/${encodeURIComponent(job.id)}/status`, { status: next });
  b.disabled = false;
  if (!r.ok) return toast('Could not save status');
  job.status = next;
  toast(next === 'new' ? 'Moved back to new' : `Marked ${next}`);
  renderJobs();
});

/* ---------- companies ---------- */
const HIRING = { live: ['Live listings', 'loc-remote'], hr_email: ['HR email only', 'info'], stale: ['Stale page', 'warn'], none: ['No careers page', ''] };
function renderCompanies() {
  const f = new FormData($('#coFilters'));
  const q = (f.get('q') || '').toLowerCase();
  const h = f.get('hiring');
  const rows = state.companies.filter((c) => {
    if (h === 'rejected' ? c.is_software !== 0 : h !== 'all' && (c.hiring_status !== h || c.is_software === 0)) return false;
    return !q || `${c.name} ${c.domain} ${c.stack.join(' ')} ${c.notes || ''}`.toLowerCase().includes(q);
  });
  $('#cCompanies').textContent = state.companies.filter((c) => c.is_software).length || '';
  $('#coTable').innerHTML = `<thead><tr><th>Company</th><th class="num">Fit</th><th>Hiring</th><th>Type</th><th>Stack</th><th class="num">Open jobs</th><th>Contact</th></tr></thead><tbody>${
    rows
      .map((c) => {
        const [hl, hc] = c.is_software === 0 ? ['Not software', 'bad'] : HIRING[c.hiring_status] || ['Not judged yet', ''];
        return `<tr>
        <td><a class="nm" href="${safeUrl(c.website)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>${c.contacted ? ' <span class="chip warn">already contacted</span>' : ''}<div class="small">${esc(c.domain || '')}${c.notes ? ` · ${esc(c.notes)}` : ''}</div></td>
        <td class="num"><span class="fit" style="color:${scoreColor(c.fit ?? 0)}">${c.fit ?? '–'}</span></td>
        <td><span class="chip ${hc}">${esc(hl)}</span>${c.careers_url ? `<div class="small"><a href="${safeUrl(c.careers_url)}" target="_blank" rel="noopener noreferrer">careers page</a>${c.ats ? ` · ${esc(c.ats)}` : ''}</div>` : ''}</td>
        <td>${esc(c.kind || '–')}<div class="small">${esc(c.size && c.size !== 'unknown' ? c.size : '')}${c.foreign_clients ? ' · foreign clients' : ''}</div></td>
        <td class="small">${esc(c.stack.join(', '))}</td>
        <td class="num">${c.open_jobs}${c.best_score != null ? `<div class="small">best ${c.best_score}</div>` : ''}</td>
        <td class="small">${c.hr_email ? `<a href="mailto:${esc(c.hr_email)}">${esc(c.hr_email)}</a>` : '–'}</td></tr>`;
      })
      .join('') || '<tr><td colspan="7" class="muted">No companies match.</td></tr>'
  }</tbody>`;
}
$('#coFilters').addEventListener('input', renderCompanies);

/* ---------- outreach ---------- */
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast('Clipboard blocked: select the text instead');
  }
}

function renderOutreach() {
  $('#cOutreach').textContent = state.outreach.filter((c) => c.outreach_status === 'todo').length || '';
  $('#outreachList').innerHTML =
    state.outreach
      .map(
        (c) => `<article class="mail ${c.outreach_status !== 'todo' ? 'done' : ''}" data-id="${c.id}">
      <div class="mail-head"><div><h3>${esc(c.name)}</h3><div class="co">${esc(c.kind || '')}${c.size && c.size !== 'unknown' ? `<span class="dot">${esc(c.size)} people</span>` : ''}${c.contacted ? '<span class="dot">already contacted</span>' : ''}${c.outreach_status !== 'todo' ? `<span class="dot">${esc(c.outreach_status)}</span>` : ''}</div></div>
        <span class="fit" style="color:${scoreColor(c.fit)}" title="Company fit">${c.fit}</span></div>
      ${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}
      <div class="to">${esc(c.hr_email)}</div>
      <div class="subj">${esc(c.draft.subject)}</div>
      <pre>${esc(c.draft.body)}</pre>
      <div class="mail-actions">
        <button class="btn primary sm" data-act="copy-body" type="button">${icon('copy')}<span>Copy draft</span></button>
        <button class="btn sm" data-act="copy-to" type="button">${icon('mail')}<span>Copy address</span></button>
        <button class="btn sm" data-act="sent" type="button">${icon('check')}<span>${c.outreach_status === 'sent' ? 'Undo sent' : 'Mark sent'}</span></button>
        <button class="btn sm" data-act="skipped" type="button">${icon('x')}<span>${c.outreach_status === 'skipped' ? 'Undo skip' : 'Skip'}</span></button>
      </div></article>`
      )
      .join('') || '<div class="empty">No cold-email candidates yet. They appear after discovery finds good-fit companies with an HR email and no open listings.</div>';
}

$('#outreachList').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const c = state.outreach.find((x) => x.id === Number(b.closest('.mail').dataset.id));
  const act = b.dataset.act;
  if (act === 'copy-body') return copy(`Subject: ${c.draft.subject}\n\n${c.draft.body}`, 'Draft');
  if (act === 'copy-to') return copy(c.hr_email, 'Address');
  const next = c.outreach_status === act ? 'todo' : act;
  const r = await post(`/api/companies/${c.id}/outreach`, { status: next });
  if (!r.ok) return toast('Could not save');
  c.outreach_status = next;
  renderOutreach();
});

/* ---------- runs ---------- */
function runStats(r) {
  const s = r.stats || {};
  const keys = {
    collect: ['queries', 'listings', 'new_places', 'new_companies', 'noise', 'payload_coverage'],
    discover: ['companies', 'reachable', 'with_careers', 'with_ats', 'with_hr_email', 'rejected', 'requests'],
    watch: ['sources', 'ats_ok', 'unchanged', 'changed', 'claude_pages', 'new_jobs', 'claude_jobs', 'closed', 'errors'],
  }[r.kind] || Object.keys(s);
  return keys.filter((k) => s[k] != null).map((k) => `${k.replace(/_/g, ' ')} <b>${esc(s[k])}</b>`).join(' · ');
}
function renderRuns() {
  $('#runTable').innerHTML = `<thead><tr><th>Run</th><th>When</th><th>Took</th><th>Status</th><th>Numbers</th></tr></thead><tbody>${
    state.runs
      .map((r) => {
        const took = r.ended_at ? Math.max(1, Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60000)) + ' min' : '–';
        const cls = { done: 'loc-remote', blocked: 'bad', error: 'bad', awaiting_claude: 'warn', running: 'info', partial: 'warn' }[r.status] || '';
        return `<tr><td class="nm">${esc(r.kind)}${r.city ? ` <span class="small">${esc(r.city)}</span>` : ''}<div class="small">${esc(r.id)}</div></td><td class="small">${new Date(r.started_at).toLocaleString()}</td><td class="num">${took}</td><td><span class="chip ${cls}">${esc(r.status.replace('_', ' '))}</span></td><td class="small">${runStats(r)}${r.message && r.status !== 'done' ? `<div>${esc(r.message)}</div>` : ''}</td></tr>`;
      })
      .join('') || '<tr><td colspan="5" class="muted">No runs yet.</td></tr>'
  }</tbody>`;
}

/* ---------- boot ---------- */
async function load() {
  const [summary, jobs, companies, outreach, runs] = await Promise.all([api('/api/summary'), api('/api/jobs'), api('/api/companies'), api('/api/outreach'), api('/api/runs')]);
  Object.assign(state, { summary, jobs: jobs.jobs, lastWatch: jobs.last_watch, newSince: jobs.new_since, quiet: jobs.quiet, companies: companies.companies, outreach: outreach.companies, runs: runs.runs });
  renderSummary();
  restoreJobFilters();
  renderJobs();
  renderCompanies();
  renderOutreach();
  renderRuns();
}
load().catch((e) => {
  $('#lastRun').textContent = `Could not load data: ${e.message}`;
});
