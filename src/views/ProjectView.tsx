import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, Compass, HelpCircle, ListChecks, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { projects, type ProjectDefinition, type ProjectPhase } from '../data/projects';
import { useI18n } from '../i18n/I18nContext';

const phaseOrder: ProjectPhase[] = ['PLANNING', 'FOUNDATION', 'CORE', 'TESTING', 'CONCEPT LIVE'];

function splitCountdown(targetIso: string, now: number) {
  const remaining = Math.max(0, new Date(targetIso).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  return {
    live: remaining === 0,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

function Countdown({ project }: { project: ProjectDefinition }) {
  const [now, setNow] = useState(() => Date.now());
  const { t } = useI18n();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = useMemo(() => splitCountdown(project.targetIso, now), [project.targetIso, now]);

  if (countdown.live) {
    return <div className="project-countdown project-countdown--live"><strong>{t('CONCEPT LIVE')}</strong><span>{t('The target date has arrived.')}</span></div>;
  }

  const values = [
    ['Days', countdown.days],
    ['Hours', countdown.hours],
    ['Minutes', countdown.minutes],
    ['Seconds', countdown.seconds],
  ] as const;

  return (
    <div className="project-countdown" aria-live="polite">
      {values.map(([label, value]) => (
        <div key={label} className="project-countdown__unit">
          <strong>{String(value).padStart(2, '0')}</strong>
          <span>{t(label)}</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectView() {
  const { slug } = useParams();
  const project = slug === 'speculus' || slug === 'fabula' ? projects[slug] : null;
  const { t } = useI18n();

  if (!project) {
    return (
      <section className="page project-page">
        <Link className="back-link" to="/"><ArrowLeft size={15} /> {t('Back to Coda')}</Link>
        <div className="state-panel"><strong>{t('Project not found')}</strong><span>{t('This roadmap entry does not exist.')}</span></div>
      </section>
    );
  }

  const currentPhaseIndex = phaseOrder.indexOf(project.phase);

  return (
    <section className={`page project-page project-page--${project.slug}`}>
      <Link className="back-link" to="/"><ArrowLeft size={15} /> {t('Back to Coda')}</Link>

      <header className="project-hero">
        <div className="project-hero__copy">
          <span className="eyebrow">{t('THE HOWLING WHISPERS · DEVELOPMENT ROADMAP')}</span>
          <h1>{project.name}</h1>
          <p>{t(project.summary)}</p>
          <div className="project-hero__meta">
            <span><CalendarDays size={15} /> {t('Target')}: {project.targetLabel}</span>
            <span><Clock3 size={15} /> {t(project.releaseLabel)}</span>
          </div>
        </div>
        <div className="project-hero__status">
          <small>{t('Current phase')}</small>
          <strong>{t(project.phase)}</strong>
          <span>{project.progress}% {t('of concept plan')}</span>
        </div>
      </header>

      <section className="project-panel project-release-panel">
        <div className="project-panel__heading">
          <div><span className="eyebrow">{t('RELEASE CLOCK')}</span><h2>{t(project.releaseLabel)}</h2></div>
          <span className="project-target-date">{project.targetLabel}</span>
        </div>
        <Countdown project={project} />
        <p className="project-release-note"><strong>{t('Target date, not a lockout.')}</strong> {t('Development is continuous. Demos, prototypes, test builds and semi-working versions may appear before the countdown ends. If the project reaches this milestone early, it may release ahead of schedule.')}</p>
        <div className="project-progress" aria-label={`${project.progress}%`}>
          <div className="project-progress__track"><span style={{ width: `${Math.max(0, Math.min(100, project.progress))}%` }} /></div>
          <div className="project-progress__labels"><span>{t('Concept progress')}</span><strong>{project.progress}%</strong></div>
        </div>
        <div className="project-phases">
          {phaseOrder.map((phase, index) => (
            <div key={phase} className={`project-phase ${index < currentPhaseIndex ? 'is-done' : ''} ${index === currentPhaseIndex ? 'is-current' : ''}`}>
              <i>{index < currentPhaseIndex ? <CheckCircle2 size={14} /> : index + 1}</i>
              <span>{t(phase)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="project-grid">
        <section className="project-panel">
          <div className="project-panel__icon"><Compass size={18} /></div>
          <span className="eyebrow">{t('WHAT IS THIS?')}</span>
          <h2>{t('Purpose')}</h2>
          <p>{t(project.purpose)}</p>
        </section>

        <section className="project-panel">
          <div className="project-panel__icon"><Target size={18} /></div>
          <span className="eyebrow">{t('CURRENT STATUS')}</span>
          <h2>{t(project.phase)}</h2>
          <p>{t(project.status)}</p>
          <dl className="project-status-list">
            <div><dt>{t('Next milestone')}</dt><dd>{t(project.nextMilestone)}</dd></div>
            <div><dt>{t('Last updated')}</dt><dd>{project.lastUpdated}</dd></div>
          </dl>
        </section>
      </div>

      <section className="project-panel">
        <div className="project-panel__heading">
          <div><span className="eyebrow">{t('EXPECTED FEATURES')}</span><h2>{t('First concept scope')}</h2></div>
          <ListChecks size={21} />
        </div>
        <div className="project-feature-grid">
          {project.expectedFeatures.map((feature) => <div key={feature}><CheckCircle2 size={15} /><span>{t(feature)}</span></div>)}
        </div>
      </section>

      <section className="project-panel project-later">
        <span className="eyebrow">{t('AFTER THE FIRST CONCEPT')}</span>
        <h2>{t('What comes later')}</h2>
        <div className="project-feature-grid project-feature-grid--later">
          {project.laterFeatures.map((feature) => <div key={feature}><span className="project-feature-dot" /><span>{t(feature)}</span></div>)}
        </div>
      </section>

      <section className="project-panel project-qa">
        <div className="project-panel__heading">
          <div><span className="eyebrow">{t('Q&A')}</span><h2>{t('Common questions')}</h2></div>
          <HelpCircle size={21} />
        </div>
        <div className="project-qa__list">
          {project.qa.map((item) => (
            <details key={item.question}>
              <summary>{t(item.question)}</summary>
              <p>{t(item.answer)}</p>
            </details>
          ))}
        </div>
      </section>
    </section>
  );
}
