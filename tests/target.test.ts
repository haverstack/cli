import { describe, expect, it } from 'vitest';
import {
  formatTarget,
  grantQueryOf,
  grantTargetOf,
  parseTarget,
  permissionTargetOf,
  relationshipTargetOf,
} from '../src/target.js';

describe('parseTarget', () => {
  it('reads the two bare tiers', () => {
    expect(parseTarget('anyone')).toEqual({ kind: 'anyone' });
    expect(parseTarget('authenticated')).toEqual({ kind: 'authenticated' });
  });

  it('treats a bare DID as an entity — the one inferred shape', () => {
    expect(parseTarget('did:key:z6MkAlice')).toEqual({
      kind: 'entity',
      entityId: 'did:key:z6MkAlice',
    });
    expect(parseTarget('entity:did:key:z6MkAlice')).toEqual(parseTarget('did:key:z6MkAlice'));
  });

  it('reads a group with its role', () => {
    expect(parseTarget('group:01hx/admin')).toEqual({
      kind: 'group',
      groupId: '01hx',
      role: 'admin',
    });
    expect(parseTarget('group:01hx/any')).toEqual({ kind: 'group', groupId: '01hx', role: 'any' });
  });

  it('reads a record, with and without another stack', () => {
    expect(parseTarget('record:01hx')).toEqual({ kind: 'record', recordId: '01hx' });
    expect(parseTarget('record:01hx@https://other.example')).toEqual({
      kind: 'record',
      recordId: '01hx',
      stackUrl: 'https://other.example',
    });
  });

  it('splits an external target on its first slash, so the id may hold more', () => {
    expect(parseTarget('external:atproto/at://did:plc:x/app.bsky.feed.post/3k')).toEqual({
      kind: 'external',
      ns: 'atproto',
      id: 'at://did:plc:x/app.bsky.feed.post/3k',
    });
  });

  it('refuses a scheme it does not know rather than guessing an arm', () => {
    expect(() => parseTarget('mystery:x')).toThrow(/not a target scheme/);
    expect(() => parseTarget('01hx3k9m2p7q')).toThrow(/names no scheme/);
    expect(() => parseTarget('  ')).toThrow(/cannot be empty/);
  });

  it('names what is missing from a half-written target', () => {
    expect(() => parseTarget('group:01hx')).toThrow(/names no role/);
    expect(() => parseTarget('group:01hx/owner')).toThrow(/not a role/);
    expect(() => parseTarget('group:/admin')).toThrow(/needs a record id/);
    expect(() => parseTarget('external:atproto')).toThrow(/no identifier within it/);
    expect(() => parseTarget('entity:')).toThrow(/needs a DID/);
    expect(() => parseTarget('record:01hx@')).toThrow(/needs its URL/);
  });

  it('round-trips every arm through formatTarget', () => {
    for (const s of [
      'anyone',
      'authenticated',
      'did:key:z6MkAlice',
      'group:01hx/member',
      'record:01hx',
      'record:01hx@https://other.example',
      'external:atproto/at://x',
    ]) {
      expect(formatTarget(parseTarget(s))).toBe(s);
    }
  });
});

describe('narrowing per command', () => {
  it('gives perm the arms it accepts', () => {
    expect(permissionTargetOf(parseTarget('anyone'))).toEqual({ scope: 'anyone' });
    expect(permissionTargetOf(parseTarget('group:g/admin'))).toEqual({
      scope: 'group',
      groupId: 'g',
      role: 'admin',
    });
    expect(() => permissionTargetOf(parseTarget('record:01hx'))).toThrow(
      /not something `perm` can name/,
    );
    expect(() => permissionTargetOf(parseTarget('authenticated'))).toThrow(/`perm` can name/);
    expect(() => permissionTargetOf(parseTarget('group:g/any'))).toThrow(/listing role/);
  });

  it('gives grant the arms it accepts, and keeps `any` to the listing', () => {
    expect(grantTargetOf(parseTarget('authenticated'))).toEqual({ kind: 'authenticated' });
    expect(grantQueryOf(parseTarget('group:g/any'))).toEqual({
      kind: 'group',
      groupId: 'g',
      role: 'any',
    });
    expect(() => grantTargetOf(parseTarget('group:g/any'))).toThrow(/`any` is for `grant ls`/);
    expect(() => grantTargetOf(parseTarget('anyone'))).toThrow(/not something `grant` can name/);
  });

  it('gives link the arms it accepts', () => {
    expect(relationshipTargetOf(parseTarget('record:01hx@https://x'))).toEqual({
      scope: 'record',
      recordId: '01hx',
      stackUrl: 'https://x',
    });
    expect(relationshipTargetOf(parseTarget('external:email/a@b.example'))).toEqual({
      scope: 'external',
      ns: 'email',
      id: 'a@b.example',
    });
    expect(() => relationshipTargetOf(parseTarget('anyone'))).toThrow(
      /not something `link` can name/,
    );
    expect(() => relationshipTargetOf(parseTarget('group:g/admin'))).toThrow(/`link` can name/);
  });
});
