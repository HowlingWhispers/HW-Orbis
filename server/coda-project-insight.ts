import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProjectInsightSourceStatus {
  id: string;
  name: string;
  available: boolean;
  documentCount: number;
  lastRepositoryUpdate: string | null;
}

type ProjectDefinition = {
  id: string;
  name: string;
  aliases: string[];
  candidates: string[];
};

type IndexedDocument = {
  projectId: string;
  projectName: string;
  relativePath: string;
  text: string;
  repositoryUpdatedAt: string | null;
};

type EvidenceChunk = {
  projectName: string;
  relativePath: string;
  text: string;
  repositoryUpdatedAt: string | null;
  score: number;
};

const currentFile = fileURLToPath(import.meta.url);
const currentRepoCandidate = path.resolve(path.dirname(currentFile), '..');
const CACHE_MS = 60_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_REFERENCE_CHARS = 5_200;
const CHUNK_TARGET = 1_150;

const projects: ProjectDefinition[] = [
  {
    id: 'orbis', name: 'Orbis', aliases: ['orbis', 'library', 'world forge', 'archive'],
    candidates: [currentRepoCandidate, '/srv/howling-whispers/orbis', '/var/www/hw/orbis'],
  },
  {
    id: 'speculus', name: 'Speculus', aliases: ['speculus', 'simulator', 'simulation'],
    candidates: ['/srv/howling-whispers/speculus', '/srv/howling-whispers/HW-Speculus', '/var/www/hw/speculus'],
  },
  {
    id: 'fabula', name: 'Fabula', aliases: ['fabula', 'fabula engine', 'runtime', 'living world'],
    candidates: ['/srv/howling-whispers/fabula', '/srv/howling-whispers/HW-Fabula', '/var/www/hw/fabula'],
  },
  {
    id: 'coda', name: 'Coda', aliases: ['coda core', 'discord coda', 'coda bot'],
    candidates: ['/srv/howling-whispers/coda', '/srv/howling-whispers/HW-Coda'],
  },
  {
    id: 'mouseion', name: 'Mouseion', aliases: ['mouseion', 'creation layer'],
    candidates: ['/srv/howling-whispers/mouseion', '/srv/howling-whispers/HW-Mouseion'],
  },
  {
    id: 'studium', name: 'Studium', aliases: ['studium', 'research layer'],
    candidates: ['/srv/howling-whispers/studium', '/srv/howling-whispers/HW-Studium'],
  },
  {
    id: 'landing', name: 'Howling Whispers Landing', aliases: ['landing', 'welcome page', 'howling whispers website'],
    candidates: ['/srv/howling-whispers/landing', '/srv/howling-whispers/HW-Landing'],
  },
];

const safeRootNames = new Set([
  'readme.md', 'changelog.md', 'current_state.md', 'current-state.md', 'status.md',
  'roadmap.md', 'project.md', 'projects.md', 'project_boundaries.md', 'repository_map.md',
]);

// Even when these live under docs/, they describe privileged infrastructure or
// security boundaries and are not appropriate evidence for ordinary Discord members.
const blockedPathPattern = /(?:^|\/)(?:\.git|node_modules|dist|dist-server|coverage|private|secrets?)(?:\/|$)|(?:kilo|deploy|deployment|administration|authentication|api[_-]?contract|credential|secret|runbook|migration|server[_-]?ops|incident)/i;

const projectQuestionPattern = /\b(?:project|roadmap|plan|planned|feature|release|development|developing|status|implemented|implementation|multiplayer|orbis|speculus|fabula|mouseion|studium|howling whispers|world forge|runtime|simulator|library|engine|architecture|milestone|changelog|what changed|working on)\b/i;

const stopWords = new Set([
  'about', 'after', 'again', 'also', 'been', 'being', 'could', 'does', 'have', 'into', 'just',
  'more', 'should', 'that', 'their', 'there', 'these', 'they', 'this', 'what', 'when', 'where',
  'which', 'with', 'would', 'your', 'coda', 'please', 'tell', 'know', 'from', 'will', 'want',
]);

let cache: { builtAt: number; documents: IndexedDocument[]; statuses: ProjectInsightSourceStatus[] } | null = null;

function resolveProjectRoot(project: ProjectDefinition) {
  for (const candidate of project.candidates) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isDirectory()) continue;
      if (existsSync(path.join(candidate, '.git')) || project.id === 'orbis') return candidate;
    } catch {
      // Try the next allowlisted candidate.
    }
  }
  return null;
}

function gitLastUpdate(root: string) {
  try {
    return execFileSync('git', ['-C', root, 'log', '-1', '--format=%cI'], {
      encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function safeRead(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  if (blockedPathPattern.test(relative)) return null;
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const text = readFileSync(absolutePath, 'utf8');
    // Strip fenced code from the knowledge index. Project questions need the
    // documented facts, not executable snippets or copied configuration examples.
    return text.replace(/```[\s\S]*?```/g, '[code example omitted]').trim();
  } catch {
    return null;
  }
}

function walkDocs(root: string, directory: string, output: string[], depth = 0) {
  if (depth > 5 || !existsSync(directory)) return;
  let entries: ReturnType<typeof readdirSync>;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (blockedPathPattern.test(relative)) continue;
    if (entry.isDirectory()) walkDocs(root, absolute, output, depth + 1);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) output.push(absolute);
  }
}

function indexProject(project: ProjectDefinition) {
  const root = resolveProjectRoot(project);
  if (!root) {
    return {
      documents: [] as IndexedDocument[],
      status: { id: project.id, name: project.name, available: false, documentCount: 0, lastRepositoryUpdate: null } satisfies ProjectInsightSourceStatus,
    };
  }

  const repositoryUpdatedAt = gitLastUpdate(root);
  const files: string[] = [];
  for (const name of safeRootNames) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) files.push(candidate);
    // Most repositories use uppercase conventional names. Check that spelling too.
    const upper = path.join(root, name.toUpperCase());
    if (upper !== candidate && existsSync(upper)) files.push(upper);
  }
  walkDocs(root, path.join(root, 'docs'), files);

  // Orbis's project pages are intentionally member-facing even though their source
  // data lives under src/. This one file is an explicit exception to the docs-only rule.
  if (project.id === 'orbis') {
    const publicProjectRegistry = path.join(root, 'src', 'data', 'projects.ts');
    if (existsSync(publicProjectRegistry)) files.push(publicProjectRegistry);
  }

  const seen = new Set<string>();
  const documents: IndexedDocument[] = [];
  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    if (seen.has(relativePath) || blockedPathPattern.test(relativePath)) continue;
    seen.add(relativePath);
    const text = safeRead(root, file);
    if (!text) continue;
    documents.push({ projectId: project.id, projectName: project.name, relativePath, text, repositoryUpdatedAt });
  }

  return {
    documents,
    status: {
      id: project.id,
      name: project.name,
      available: true,
      documentCount: documents.length,
      lastRepositoryUpdate: repositoryUpdatedAt,
    } satisfies ProjectInsightSourceStatus,
  };
}

function buildIndex() {
  if (cache && Date.now() - cache.builtAt < CACHE_MS) return cache;
  const documents: IndexedDocument[] = [];
  const statuses: ProjectInsightSourceStatus[] = [];
  for (const project of projects) {
    const indexed = indexProject(project);
    documents.push(...indexed.documents);
    statuses.push(indexed.status);
  }
  cache = { builtAt: Date.now(), documents, statuses };
  return cache;
}

function tokens(value: string) {
  return [...new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])
    .filter((token) => !stopWords.has(token)))];
}

function chunks(document: IndexedDocument) {
  const paragraphs = document.text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const output: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_TARGET) {
      output.push(current);
      current = '';
    }
    current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  if (current) output.push(current);
  return output;
}

function scoreChunk(question: string, queryTokens: string[], document: IndexedDocument, text: string) {
  const lowerQuestion = question.toLowerCase();
  const lower = `${document.relativePath}\n${text}`.toLowerCase();
  let score = 0;
  const project = projects.find((candidate) => candidate.id === document.projectId);
  if (project?.aliases.some((alias) => lowerQuestion.includes(alias))) score += 24;
  for (const token of queryTokens) {
    const matches = lower.split(token).length - 1;
    score += Math.min(matches, 6) * 2;
  }
  if (/readme|current[_-]?state|status|roadmap|changelog|projects\.ts/i.test(document.relativePath)) score += 2;
  if (/changelog/i.test(document.relativePath) && /changed|new|latest|recent|update/i.test(lowerQuestion)) score += 8;
  if (/roadmap|project|projects\.ts/i.test(document.relativePath) && /plan|roadmap|future|milestone/i.test(lowerQuestion)) score += 6;
  return score;
}

export function isProjectInsightQuestion(question: string) {
  return projectQuestionPattern.test(question);
}

export function buildProjectInsight(question: string) {
  if (!isProjectInsightQuestion(question)) return '';
  const index = buildIndex();
  const queryTokens = tokens(question);
  const evidence: EvidenceChunk[] = [];

  for (const document of index.documents) {
    for (const text of chunks(document)) {
      const score = scoreChunk(question, queryTokens, document, text);
      if (score <= 0) continue;
      evidence.push({
        projectName: document.projectName,
        relativePath: document.relativePath,
        text,
        repositoryUpdatedAt: document.repositoryUpdatedAt,
        score,
      });
    }
  }

  evidence.sort((left, right) => right.score - left.score);
  if (!evidence.length) return '';

  let used = 0;
  const selected: EvidenceChunk[] = [];
  const perFile = new Map<string, number>();
  for (const item of evidence) {
    const key = `${item.projectName}:${item.relativePath}`;
    if ((perFile.get(key) ?? 0) >= 2) continue;
    const cost = item.text.length + item.projectName.length + item.relativePath.length + 80;
    if (selected.length && used + cost > MAX_REFERENCE_CHARS) continue;
    selected.push(item);
    perFile.set(key, (perFile.get(key) ?? 0) + 1);
    used += cost;
    if (selected.length >= 6 || used >= MAX_REFERENCE_CHARS) break;
  }

  if (!selected.length) return '';
  return selected.map((item, indexNumber) => {
    const freshness = item.repositoryUpdatedAt ? ` · repository updated ${item.repositoryUpdatedAt}` : '';
    return `[${indexNumber + 1}] ${item.projectName} · ${item.relativePath}${freshness}\n${item.text}`;
  }).join('\n\n');
}

export function listProjectInsightSources() {
  return buildIndex().statuses;
}

export function clearProjectInsightCache() {
  cache = null;
}
