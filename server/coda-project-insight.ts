import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProjectInsightSourceStatus {
  id: string;
  name: string;
  available: boolean;
  documentCount: number;
  branch: string | null;
  commit: string | null;
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

// Project Insight is intentionally an allowlist, not a recursive docs crawler.
// These root files are normally written for project users/collaborators and are
// the only generic files Coda is allowed to ingest from another checkout.
const safeRootNames = new Set([
  'readme.md',
  'changelog.md',
  'current_state.md',
  'current-state.md',
  'status.md',
  'roadmap.md',
  'project.md',
  'projects.md',
]);

// This is the one cross-project overview maintained explicitly for Discord Coda.
const orbisMemberSafeExtras = ['docs/CODA_PROJECT_KNOWLEDGE.md'];

// Keep ordinary banter cheap, but ground support-shaped questions even when the
// member does not name a project explicitly. These are recurring product topics
// where guessing has previously produced false answers in Discord.
const projectQuestionPattern = /\b(?:project|roadmap|plan|planned|feature|release|development|developing|status|implemented|implementation|multiplayer|orbis|speculus|fabula|mouseion|studium|howling whispers|world forge|runtime|simulator|simulation|library|engine|architecture|milestone|changelog|what changed|working on)\b/i;
const projectSupportPattern = /\b(?:save|saves|saved|save archive|playthrough|session|resume|continue|adult|18\+|18 plus|erotic|persona|greyed|grayed|disabled|discord invite|invite link|server link|mobile|phone|touch|ui|interface|bug|issue|current state|available|availability)\b/i;

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
      // Try the next explicitly allowlisted checkout.
    }
  }
  return null;
}

function gitValue(root: string, args: string[]) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function repositoryMetadata(root: string) {
  return {
    branch: gitValue(root, ['branch', '--show-current']),
    commit: gitValue(root, ['rev-parse', '--short=12', 'HEAD']),
    updatedAt: gitValue(root, ['log', '-1', '--format=%cI']),
  };
}

function safeRead(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const text = readFileSync(absolutePath, 'utf8');
    // Project questions need documented facts, not runnable snippets or copied
    // configuration examples. This also reduces the chance of echoing secrets
    // accidentally pasted into a code block.
    return text.replace(/```[\s\S]*?```/g, '[code example omitted]').trim();
  } catch {
    return null;
  }
}

function rootMemberSafeFiles(root: string) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && safeRootNames.has(entry.name.toLowerCase()))
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function indexProject(project: ProjectDefinition) {
  const root = resolveProjectRoot(project);
  if (!root) {
    return {
      documents: [] as IndexedDocument[],
      status: {
        id: project.id,
        name: project.name,
        available: false,
        documentCount: 0,
        branch: null,
        commit: null,
        lastRepositoryUpdate: null,
      } satisfies ProjectInsightSourceStatus,
    };
  }

  const metadata = repositoryMetadata(root);
  const files = rootMemberSafeFiles(root);
  if (project.id === 'orbis') {
    for (const relative of orbisMemberSafeExtras) {
      const candidate = path.join(root, relative);
      if (existsSync(candidate)) files.push(candidate);
    }
  }

  const seen = new Set<string>();
  const documents: IndexedDocument[] = [];
  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const text = safeRead(root, file);
    if (!text) continue;
    documents.push({
      projectId: project.id,
      projectName: project.name,
      relativePath,
      text,
      repositoryUpdatedAt: metadata.updatedAt,
    });
  }

  // Git freshness is useful evidence, but only branch/SHA/time are exposed. Commit
  // bodies, diffs, server paths and remote URLs are deliberately not sent to members.
  if (metadata.branch || metadata.commit || metadata.updatedAt) {
    documents.push({
      projectId: project.id,
      projectName: project.name,
      relativePath: '[repository status]',
      text: `Server checkout metadata: branch ${metadata.branch ?? 'unknown'}, commit ${metadata.commit ?? 'unknown'}, last repository update ${metadata.updatedAt ?? 'unknown'}.`,
      repositoryUpdatedAt: metadata.updatedAt,
    });
  }

  return {
    documents,
    status: {
      id: project.id,
      name: project.name,
      available: true,
      documentCount: documents.length,
      branch: metadata.branch,
      commit: metadata.commit,
      lastRepositoryUpdate: metadata.updatedAt,
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
  if (/readme|current[_-]?state|status|roadmap|changelog|coda_project_knowledge/i.test(document.relativePath)) score += 3;
  if (/changelog/i.test(document.relativePath) && /changed|new|latest|recent|update/i.test(lowerQuestion)) score += 8;
  if (/roadmap|project|coda_project_knowledge/i.test(document.relativePath) && /plan|roadmap|future|milestone/i.test(lowerQuestion)) score += 6;
  return score;
}

export function isProjectInsightQuestion(question: string) {
  return projectQuestionPattern.test(question) || projectSupportPattern.test(question);
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
