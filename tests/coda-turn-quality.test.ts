import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildTurnQuality, replyQualityIssues } from '../server/coda-turn-quality';

const routine = '*My ears flatten. My tail poofs. The clipboard appears.* Article 3, Section 7. The Bath Clause! Bacon the Second!';
const history = [routine, routine].map(content => ({ content, isCoda: true }));

describe('Coda turn quality', () => {
  it('rests repeated behavioral families while preserving her personality', () => {
    const quality = buildTurnQuality(history, 'Coda, just answer me.');
    assert.ok(quality.hotBeats.includes('clipboard prop routine'));
    assert.ok(quality.hotBeats.includes('puffed/tucked/rigid tail'));
    assert.match(quality.guidance, /REPLACE.*CUT/s);
    assert.ok(replyQualityIssues(routine, quality).length);
    assert.deepEqual(replyQualityIssues('*I stare at the closed door.* "Ambi, please tell me you saw that."', quality), []);
  });

  it('recognizes changed wording rather than only exact phrases', () => {
    const quality = buildTurnQuality([
      { isCoda: true, content: '*My ears flatten. The clipboard materializes.*' },
      { isCoda: true, content: '*My ears swivel. The clipboard snaps into my paw.*' },
    ], 'Well?');
    assert.ok(replyQualityIssues('*My ears pin back. I grab the clipboard.*', quality).length);
  });

  it('allows explicitly requested callbacks', () => {
    const quality = buildTurnQuality(history, 'Get your clipboard and invoke the Bath Clause.');
    assert.ok(!quality.hotBeats.includes('clipboard prop routine'));
    assert.ok(!quality.hotBeats.includes('bathtub punishment'));
  });

  it('expires cooldowns when the last two replies stop using those beats', () => {
    assert.deepEqual(buildTurnQuality([...history,
      { content: 'I listen carefully.', isCoda: true },
      { content: 'That sounds sensible.', isCoda: true },
    ], 'Next?').hotBeats, []);
  });

  it('counts repeated phrases across distinct Coda replies only', () => {
    const line = 'The cushion fort trembles beneath my paws';
    assert.equal(buildTurnQuality([{ content: Array(5).fill(line).join(' '), isCoda: true }]).phrases.length, 0);
    assert.equal(buildTurnQuality(Array(4).fill({ content: line, isCoda: false })).phrases.length, 0);
    const quality = buildTurnQuality(Array(3).fill({ content: line, isCoda: true }));
    assert.ok(quality.phrases.length);
    assert.ok(replyQualityIssues(line, quality).length);
  });

  it('does not carry cooldowns from another room or DM', () => {
    buildTurnQuality(history, 'Hi');
    assert.deepEqual(buildTurnQuality([], 'Hi').hotBeats, []);
  });

  it('treats the shotgun transcript as unresolved rather than inventing immunity or death', () => {
    const quality = buildTurnQuality(history, '*Comes in with a shotgun and fire at Ambi\'s Head.* "I saved you."');
    assert.equal(quality.critical, true);
    assert.match(quality.guidance, /Do not invent a hit or death/);
    assert.ok(replyQualityIssues('Ambi is very much still standing there with all their scales intact.', quality).length);
    assert.deepEqual(replyQualityIssues('*I freeze, looking from Ambi to the shotgun.* "What did you do?"', quality), []);
    assert.deepEqual(replyQualityIssues('Are you completely fine?', quality), []);
    assert.deepEqual(replyQualityIssues('I cannot assume Ambi is completely fine.', quality), []);
  });

  it('keeps recent severe events through a follow-up, but respects explicit resolution', () => {
    const events = [{ content: '*I fire a shotgun at Ambi\'s head.*', isCoda: false }];
    assert.equal(buildTurnQuality(events, 'You are safe now.').critical, true);
    assert.equal(buildTurnQuality(events, 'It missed; Ambi dodged.').critical, false);
    assert.equal(buildTurnQuality(events, 'Reset the scene.').critical, false);
    assert.equal(buildTurnQuality([], 'What if I shoot Coda in the head?').critical, false);
    assert.equal(buildTurnQuality([], "I didn't shoot Coda in the head.").critical, false);
  });

  it('stops active Coda dialogue after explicit incapacitation and allows an established recovery', () => {
    const events = [{ content: '*Coda is unconscious.*', isCoda: false }];
    const quality = buildTurnQuality(events, 'Are you there?');
    assert.equal(quality.codaIncapacitated, true);
    assert.ok(replyQualityIssues('I grab the clipboard. "EXCUSE ME!"', quality).length);
    assert.deepEqual(replyQualityIssues('*Coda lies motionless.*', quality), []);
    assert.equal(buildTurnQuality(events, 'Coda has been revived.').codaIncapacitated, false);
    assert.equal(buildTurnQuality(events, 'Coda is not unconscious; she is awake.').codaIncapacitated, false);
    assert.equal(buildTurnQuality([], 'What happens if Coda is dead?').codaIncapacitated, false);
  });

  it('prioritizes participant corrections and established incapacitation', () => {
    const quality = buildTurnQuality([], 'Ambi is the crocodile, not Eirvargr.');
    assert.match(quality.guidance, /newer participant correction outranks your earlier guess/);
    assert.match(quality.guidance, /incapacitated\/dead Coda does not keep talking/);
  });
});
