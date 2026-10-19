# pk-job-radar

Finds engineering jobs at Pakistani software companies, straight from their own career pages and
public ATS feeds (Workable, Lever, Greenhouse, Recruitee, BambooHR, Breezy, SmartRecruiters, Ashby)
plus Rozee.pk, scores each job against your profile, and builds a cold-email list of good-fit
companies that have no open listings. Everything runs locally; data lives in `data/radar.db` (SQLite).

## Setup

```bash
npm install
cp config/profile.example.json config/profile.local.json
```

Edit `config/profile.local.json` with your own details (it is gitignored). Without it the tool uses
the example profile. Cities, tech-hub areas and search terms are in `config/cities.json`; Rozee
cities and queries in `config/rozee.json`.

## Pipeline

| Step | Command | What it does |
|---|---|---|
| Collect | `npm run collect -- lahore` | Google Maps area searches → companies merged by domain |
| Discover | `npm run discover -- --limit=50 --city=lahore` | Probes each site for careers pages, ATS boards and HR emails, writes a judging packet |
| Watch | `npm run watch` | Re-reads ATS feeds and careers pages; only changed pages need extraction |
| Rozee | `npm run rozee` | Reads Rozee.pk search results (one city per day) |
| Status | `npm run status` | Funnel numbers and the best new matches |
| Dashboard | `npm run dashboard` | http://localhost:4317 — jobs, companies, cold-email drafts |
| Export | `npm run export` | CSV of open jobs |
| Tests | `npm test` | |

Discover and watch write Markdown packets to `data/work/`. Judging companies and extracting jobs from
free-form careers pages is done by reading the packet (designed for Claude Code) and writing the JSON
answer next to it; then `npm run discover:apply -- <runId>` / `npm run watch:apply -- <runId>`.
The rules are in `docs/discover-rubric.md` and `docs/extract-rules.md`.

## Be polite

- Google Maps: keep to ~30 searches per session, sessions ≥4 hours apart. The collector stops on a
  CAPTCHA or throttling; don't retry that day.
- Company sites are fetched at most once every 1.5 s per host; Rozee at most 12 requests a day.
- The tool never submits applications or sends email. Drafts are for you to review and send.
