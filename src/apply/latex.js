const SPECIAL = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

export const tex = (s) =>
  String(s ?? '')
    .replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c])
    .replace(/→/g, 'to')
    .replace(/\s+/g, ' ')
    .trim();

// Tightest last: each level is tried only if the page still overflows.
export const LAYOUTS = [
  { size: '10pt', margin: '1.5cm', vmargin: '1.2cm', spread: '1.05', itemsep: '2pt', secgap: '7pt' },
  { size: '10pt', margin: '1.35cm', vmargin: '1.0cm', spread: '1.0', itemsep: '1pt', secgap: '5pt' },
  { size: '9.5pt', margin: '1.3cm', vmargin: '0.9cm', spread: '1.0', itemsep: '1pt', secgap: '4pt' },
];

export function buildCvTex(cv, facts, layout = LAYOUTS[0]) {
  const c = facts.contact;
  const job = facts.experience.current;
  const fl = facts.experience.freelance;
  const location = c.location_lines?.[cv.location] || cv.location || c.home;
  const fontSwitch = layout.size === '9.5pt' ? '\\fontsize{9.5}{11.4}\\selectfont' : '';
  const skills = (cv.skills || []).map((s) => `\\item \\textbf{${tex(s.label)}:} ${tex(s.items)}`).join('\n');
  const bullets = (cv.current_bullets || []).map((b) => `\\item ${b.lead ? `\\textbf{${tex(b.lead)}:} ` : ''}${tex(b.text)}`).join('\n');
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[a4paper,margin=${layout.margin},top=${layout.vmargin},bottom=${layout.vmargin}]{geometry}
\\usepackage{fontspec}
\\setmainfont{Liberation Sans}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\hypersetup{pdftitle={${tex(c.name)} - CV - ${tex(cv.pdf_role || cv.headline.split('|')[0])}},pdfauthor={${tex(c.name)}}}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\linespread{${layout.spread}}
\\titleformat{\\section}{\\large\\bfseries}{}{0pt}{}[\\vspace{-6pt}\\rule{\\linewidth}{0.4pt}]
\\titlespacing*{\\section}{0pt}{${layout.secgap}}{4pt}
\\let\\olditemize\\itemize\\renewcommand{\\itemize}{\\olditemize\\setlength{\\itemsep}{${layout.itemsep}}\\setlength{\\topsep}{3pt}\\setlength{\\parsep}{0pt}\\setlength{\\leftmargin}{14pt}}
\\newcommand{\\job}[4]{\\textbf{#1} \\hfill #3\\\\ #2 \\hfill #4\\par}
\\begin{document}
${fontSwitch}
{\\LARGE\\bfseries ${tex(c.name)}}\\\\[3pt]
${tex(cv.headline).replace(/ \| /g, ' \\textbar{} ')}\\\\[2pt]
${tex(location)} \\textbar{} ${tex(c.phone)} \\textbar{} ${tex(c.email)}\\\\
\\href{${c.github_url}}{${tex(c.github)}} \\textbar{} \\href{${c.linkedin_url}}{${tex(c.linkedin)}}

\\section{Summary}
${tex(cv.summary)}

\\section{Skills}
\\begin{itemize}
${skills}
\\end{itemize}

\\section{Experience}
\\job{${tex(cv.current_title || job.title_options[0])}}{${tex(job.employer)}}{${tex(job.dates)}}{${tex(job.place)}}
${tex(cv.current_intro || job.intro)}
\\begin{itemize}
${bullets}
\\end{itemize}

\\vspace{3pt}
\\job{${tex(fl.title)}}{${tex(fl.employer)}}{${tex(fl.dates)}}{${tex(fl.place)}}
\\begin{itemize}
\\item ${tex(cv.freelance_bullet || fl.facts.join(' '))}
\\end{itemize}

\\section{Education}
${tex(facts.education)}\\\\
\\textbf{Languages:} ${tex(facts.languages)}

\\end{document}
`;
}
