import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createEmberInternalRouter, createEmberLaunchRouter } from '../server/ember';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import type { SettingsStore } from '../server/settings';

const userId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333';
const secret = 'test-ember-internal-secret-at-least-32-chars';
const config = loadConfig({
  NODE_ENV:'test', APP_ORIGIN:'http://localhost:5174', DATABASE_URL:'postgres://test',
  SESSION_SECRET:'long-session-secret-value-sufficient',
  DISCORD_CLIENT_ID:'client', DISCORD_CLIENT_SECRET:'secret',
  DISCORD_REDIRECT_URI:'http://localhost:5174/api/auth/discord/callback',
  EMBER_BRIDGE_SECRET:secret,
});
const settings = { getEffective: async () => ({}) } as SettingsStore;
const makeAsset = (type: 'character' | 'world', kind: 'public'|'private'|'adult'='public') => ({
  id:assetId, type, name:type==='world'?'Bitterroot':'Ragna Holt',
  summary:'Orbis description', document:{worldSettings:{visibility:kind==='private'?'private':'public'}},
  creator_user_id:kind==='private'||kind==='adult'?'88888888-8888-4888-8888-888888888888':userId,
  content_rating:kind==='adult'?'adult':'sfw',
  origin_world_id:null,
});
function makePool(type: 'character'|'world'='character', kind:'public'|'private'|'adult'='public', sessionValid=true) {
  let redeemed=false;
  const asset=makeAsset(type, kind);
  const query=vi.fn(async (sql:string)=>{
    if (sql.includes('adult_access_override')) return { rowCount:1, rows:[{adult_access_override:false}] };
    if (sql.includes('SELECT a.*, origin.document')) return {rowCount:1,rows:[asset]};
    if (sql.includes('INSERT INTO ember_launch_tickets')) return {rowCount:1,rows:[]};
    if (sql.includes('UPDATE ember_launch_tickets')) {
      if(redeemed) return {rowCount:0,rows:[]};
      redeemed=true; return {rowCount:1,rows:[{id:linkId}]};
    }
    if (sql.includes('JOIN "session"')) return sessionValid ? {
      rowCount:1, rows:[{...asset,asset_id:asset.id,user_id:userId,link_id:linkId,mode:type,
        orbis_session:{userId,discordUserId:'999999999999999999',access:{isGuildMember:true,canViewAdult:false}}}]
    } : {rowCount:0,rows:[]};
    return {rowCount:0,rows:[]};
  });
  return {query} as unknown as DatabasePool;
}
function app(pool:DatabasePool,signedIn=true,guildMember=true) {
  const api=express();
  api.use(express.json());
  api.use((req,_res,next)=>{
    Object.defineProperty(req,'session',{configurable:true,value:signedIn?{
      userId,discordUserId:'999999999999999999',
      access:{isGuildMember:guildMember,canViewAdult:false,canCreate:false,canAdmin:false,checkedAt:Date.now()}
    }:{}});
    Object.defineProperty(req,'sessionID',{configurable:true,value:'orbis-test-session'});
    next();
  });
  api.use('/api/v1/library',createEmberLaunchRouter(config,pool,settings));
  api.use('/api/internal/ember',createEmberInternalRouter(config,pool));
  return api;
}
const launchPath=`/api/v1/library/assets/${assetId}/ember-launch`;
describe('Ember launch handoff',()=>{
  it('requires the original Orbis session',async()=>{
    const r=await request(app(makePool(),false)).post(launchPath).send({});
    expect(r.status).toBe(401);
  });
  it('requires active Discord membership',async()=>{
    const r=await request(app(makePool(),true,false)).post(launchPath).send({});
    expect(r.status).toBe(403);
  });
  it('launches world and character as separate modes without putting ticket into a URL',async()=>{
    for(const type of ['character','world'] as const) {
      const r=await request(app(makePool(type))).post(launchPath).send({});
      expect(r.status).toBe(201);
      expect(r.body.mode).toBe(type);
      expect(r.body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(r.body.launchUrl).toBe('https://thehowlingwhispers.com/ember/launch');
      expect(r.body.launchUrl).not.toContain(r.body.ticket);
    }
  });
  it('refuses inaccessible private and adult assets',async()=>{
    expect((await request(app(makePool('world','private'))).post(launchPath).send({})).status).toBe(404);
    expect((await request(app(makePool('character','adult'))).post(launchPath).send({})).status).toBe(403);
  });
  it('rejects missing bridge credentials and enforces one-time redemption',async()=>{
    const api=app(makePool());
    expect((await request(api).post('/api/internal/ember/redeem').send({ticket:'a'.repeat(43)})).status).toBe(401);
    const redeem=()=>request(api).post('/api/internal/ember/redeem').set('Authorization',`Bearer ${secret}`).send({ticket:'a'.repeat(43)});
    const first=await redeem();
    expect(first.status).toBe(200);
    expect(first.body.linkId).toBe(linkId);
    expect(first.body.asset.id).toBe(assetId);
    expect(first.body.orbis_session).toBeUndefined();
    expect((await redeem()).status).toBe(401);
  });
  it('checks the linked Orbis session and denies expired or revoked login',async()=>{
    const path='/api/internal/ember/check';
    const headers={Authorization:`Bearer ${secret}`};
    expect((await request(app(makePool())).post(path).set(headers).send({linkId})).status).toBe(200);
    expect((await request(app(makePool('character','public',false))).post(path).set(headers).send({linkId})).status).toBe(401);
  });
});
