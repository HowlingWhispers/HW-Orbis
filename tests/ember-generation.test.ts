import { describe, expect, it, vi } from 'vitest';
import { buildEmberPrompt, EmberGenerationError, generateEmberNarration, type EmberContext, type EmberTurn } from '../server/ember-generation';
import { credentialKey, sealCredential } from '../server/provider-settings';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';

const key = Buffer.alloc(32, 9).toString('base64');
const token = 'personal-orbis-novelai-test-key';
const uid = '11111111-1111-4111-8111-111111111111';
const config = loadConfig({
  NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'session-secret-for-ember-tests-12345',
  DISCORD_CLIENT_ID: 'test', DISCORD_CLIENT_SECRET: 'secret',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  ORBIS_CREDENTIAL_ENCRYPTION_KEY: key,
});
const sandbox: EmberContext = { userId: uid, mode:'sandbox', asset:null };
const hello: EmberTurn[] = [{source:'player', mode:'speech', text:'Hello'}];

function credentialPool(present=true) {
  const sealed = sealCredential(token, credentialKey(key));
  const query=vi.fn(async (_sql: string, params: string[]) => {
    expect(params).toEqual([uid]);
    return present ? {rowCount:1,rows:[{
      model:'xialong-v1',token_ciphertext:sealed.ciphertext,token_iv:sealed.iv,token_tag:sealed.tag,
    }]} : {rowCount:0,rows:[]};
  });
  return {query} as unknown as DatabasePool;
}

describe('Ember NovelAI bridge', () => {
  it('starts a blank sandbox from only the supplied player speech', () => {
    const prompt=buildEmberPrompt(sandbox, hello);
    expect(prompt).toContain('Blank freeform sandbox');
    expect(prompt).toContain('Hello');
    expect(prompt).toContain('NARRATOR:');
    expect(prompt).not.toContain('Bitterroot');
    expect(prompt).not.toContain('Ragna');
    expect(prompt).not.toContain('Ranger Station');
  });
  it('distinguishes three player input modes in the narrator prompt', () => {
    const prompt = buildEmberPrompt(sandbox, [
      {source:'player',mode:'speech',text:'Hello'},
      {source:'player',mode:'action',text:'I wave.'},
      {source:'player',mode:'thought',text:'I wonder.'},
    ]);
    expect(prompt).toContain('PLAYER (SPEECH)');
    expect(prompt).toContain('PLAYER (ACTION)');
    expect(prompt).toContain('PLAYER (THOUGHT)');
    expect(prompt).toContain('private internal thinking, never audible dialogue');
    expect(prompt).toContain('Narrate the outcome and reactions');
  });
  it('does not generate unprovided world locations from canonical references',()=>{
    const world: EmberContext={userId:uid,mode:'world',asset:{
      id:'22222222-2222-4222-8222-222222222222',type:'world',name:'Bitterroot',summary:'The land is foggy.',
    }};
    const prompt=buildEmberPrompt(world,hello);
    expect(prompt).toContain('Bitterroot');
    expect(prompt).toContain('do not create named locations');
  });
  it('uses only the authenticated Orbis user key, decrypted inside Orbis', async () => {
    const pool=credentialPool();
    const fetchFn=vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe('https://text.novelai.net/oa/v1/completions');
      expect((options.headers as Record<string,string>).Authorization).toBe(`Bearer ${token}`);
      const request=JSON.parse(String(options.body));
      expect(request.model).toBe('xialong-v1');
      expect(request.prompt).toContain('Hello');
      expect(request.stream).toBe(false);
      return new Response(JSON.stringify({choices:[{text:'NARRATOR: Hello, stranger.'}]}),{status:200});
    });
    const generated=await generateEmberNarration(config,pool,sandbox,hello,fetchFn as unknown as typeof fetch);
    expect(generated).toEqual({text:'Hello, stranger.',model:'xialong-v1'});
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(generated)).not.toContain(token);
  });
  it('refuses to use shared or alternate keys when this user has none',async()=>{
    const fetchFn=vi.fn();
    await expect(generateEmberNarration(config,credentialPool(false),sandbox,hello,fetchFn)).rejects
      .toMatchObject({status:409,code:'NOVELAI_NOT_CONFIGURED'});
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('maps rate limits to a retryable error without revealing upstream body',async()=>{
    const fetchFn=vi.fn(async () => new Response('secret upstream response',{status:429}));
    await expect(generateEmberNarration(config,credentialPool(),sandbox,hello,
      fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      status:429,code:'NOVELAI_BUSY',
    });
  });
  it('rejects empty successful responses',async()=>{
    const fetchFn=vi.fn(async () => new Response(JSON.stringify({choices:[{text:'  '}]}),{status:200}));
    await expect(generateEmberNarration(config,credentialPool(),sandbox,hello,
      fetchFn as unknown as typeof fetch)).rejects.toMatchObject({
      status:502,code:'NOVELAI_EMPTY_REPLY',
    });
  });
  it('drops old turns before the prompt exceeds its context cap',()=>{
    const many=Array.from({length:48},(_,i)=>({
      source:i%2===0?'player':'provider',
      mode:i%2===0?'action':'narrator',text:`T${i}-`+'x'.repeat(1900),
    })) as EmberTurn[];
    const prompt=buildEmberPrompt(sandbox,many);
    expect(prompt.length).toBeLessThan(30000);
    expect(prompt).toContain('T47-');
    expect(prompt).not.toContain('T0-');
  });
});
