import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

export const FACTS_FILE = fs.existsSync(path.join(ROOT, 'config/facts.local.json')) ? 'config/facts.local.json' : 'config/facts.example.json';

export const loadFacts = (file = path.join(ROOT, FACTS_FILE)) => JSON.parse(fs.readFileSync(file, 'utf8'));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Letters/digits on either side mean it's part of a longer word ("Java" inside "JavaScript").
// Symbol-edged terms (".NET", "C#") carry their own boundary, so only alphanumeric edges get one.
const termRe = (term) => {
  const pre = /^[A-Za-z0-9]/.test(term) ? '(?<![A-Za-z0-9])' : '';
  const post = /[A-Za-z0-9]$/.test(term) ? '(?![A-Za-z0-9])' : '';
  return new RegExp(`${pre}${escapeRe(term)}${post}`, 'i');
};

const RISKY = [
  [/\b(?:bachelor'?s?|b\.?\s?sc|bscs|bs\s?\(?cs|master'?s degree|graduated? (?:from|in))\b/i, 'degree claim'],
  [/\b\d{2}\s*years?\s+old\b|\bdate of birth\b|\bage\s*:/i, 'age'],
];

// Anything a CV or email must never say: skills he hasn't used, degree, age, and the facts file's own never_phrases.
export function claimProblems(text, facts) {
  const t = String(text || '');
  const out = [];
  for (const term of facts.skills?.never || []) if (termRe(term).test(t)) out.push(`never-claim skill: ${term}`);
  for (const [re, label] of RISKY) if (re.test(t)) out.push(label);
  for (const phrase of facts.never_phrases || []) {
    if (new RegExp(escapeRe(phrase).replace(/\s+/g, '\\s+'), 'i').test(t)) out.push(`never-say phrase: ${phrase}`);
  }
  return out;
}
