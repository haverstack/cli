import { describe, expect, it } from 'vitest';
import {
  parseGrantQuery,
  parseGrantTarget,
  parseLinkTarget,
  parsePermissionTarget,
  showGrantTarget,
  showLinkTarget,
  showPermissionTarget,
} from '../src/target.js';

describe('the shared grammar', () => {
  it('treats a bare DID as an entity — the one inferred shape', () => {
    expect(parsePermissionTarget('did:key:z6MkAlice')).toEqual({
      scope: 'entity',
      entityId: 'did:key:z6MkAlice',
    });
    expect(parsePermissionTarget('entity:did:key:z6MkAlice')).toEqual(
      parsePermissionTarget('did:key:z6MkAlice'),
    );
  });

  it('reads a record, with and without another stack', () => {
    expect(parseLinkTarget('record:01hx')).toEqual({ scope: 'record', recordId: '01hx' });
    expect(parseLinkTarget('record:01hx@https://other.example')).toEqual({
      scope: 'record',
      recordId: '01hx',
      stackUrl: 'https://other.example',
    });
  });

  it('splits an external target on its first slash, so the id may hold more', () => {
    expect(parseLinkTarget('external:atproto/at://did:plc:x/app.bsky.feed.post/3k')).toEqual({
      scope: 'external',
      ns: 'atproto',
      id: 'at://did:plc:x/app.bsky.feed.post/3k',
    });
  });

  it('refuses a scheme it does not know rather than guessing an arm', () => {
    expect(() => parseLinkTarget('mystery:x')).toThrow(/not a target scheme/);
    expect(() => parseLinkTarget('01hx3k9m2p7q')).toThrow(/names no scheme/);
    expect(() => parsePermissionTarget('  ')).toThrow(/cannot be empty/);
  });

  it('names what is missing from a half-written target', () => {
    expect(() => parsePermissionTarget('group:01hx')).toThrow(/names no role/);
    expect(() => parsePermissionTarget('group:01hx/owner')).toThrow(/not a role/);
    expect(() => parsePermissionTarget('group:/admin')).toThrow(/needs a record id/);
    expect(() => parseLinkTarget('external:atproto')).toThrow(/no identifier within it/);
    expect(() => parsePermissionTarget('entity:')).toThrow(/needs a DID/);
    expect(() => parseLinkTarget('record:01hx@')).toThrow(/needs its URL/);
  });

  it('round-trips every arm back into the grammar that produced it', () => {
    for (const s of ['anyone', 'did:key:z6MkAlice', 'group:01hx/member']) {
      expect(showPermissionTarget(parsePermissionTarget(s))).toBe(s);
    }
    for (const s of ['authenticated', 'did:key:z6MkAlice', 'group:01hx/any']) {
      expect(showGrantTarget(parseGrantQuery(s))).toBe(s);
    }
    for (const s of [
      'did:key:z6MkAlice',
      'record:01hx',
      'record:01hx@https://other.example',
      'external:atproto/at://x',
    ]) {
      expect(showLinkTarget(parseLinkTarget(s))).toBe(s);
    }
  });
});

describe('each command takes only its own arms', () => {
  it('gives perm what it accepts', () => {
    expect(parsePermissionTarget('anyone')).toEqual({ scope: 'anyone' });
    expect(parsePermissionTarget('group:g/admin')).toEqual({
      scope: 'group',
      groupId: 'g',
      role: 'admin',
    });
    expect(() => parsePermissionTarget('group:g/any')).toThrow(/listing role/);
  });

  it('gives grant what it accepts, and keeps `any` to the listing', () => {
    expect(parseGrantTarget('authenticated')).toEqual({ kind: 'authenticated' });
    expect(parseGrantQuery('group:g/any')).toEqual({ kind: 'group', groupId: 'g', role: 'any' });
    expect(() => parseGrantTarget('group:g/any')).toThrow(/`any` is for `grant ls`/);
  });

  it('gives link what it accepts', () => {
    expect(parseLinkTarget('external:email/a@b.example')).toEqual({
      scope: 'external',
      ns: 'email',
      id: 'a@b.example',
    });
  });
});

describe('refusing a target from the wrong tier', () => {
  it('sends a grant naming the world to the authenticated tier', () => {
    expect(() => parseGrantTarget('anyone')).toThrow(/not something `grant` can name/);
    expect(() => parseGrantTarget('anyone')).toThrow(/did you mean `authenticated`/);
  });

  it('never offers `anyone` to perm as a synonym for `authenticated`', () => {
    // `anyone` is the wider tier, so naming it must stay a choice.
    expect(() => parsePermissionTarget('authenticated')).toThrow(/no authenticated tier/);
    expect(() => parsePermissionTarget('authenticated')).toThrow(
      /wider — it reaches anonymous requesters too/,
    );
    expect(() => parsePermissionTarget('authenticated')).not.toThrow(/did you mean/);
  });

  it('points a link at the group’s own record, by id', () => {
    expect(() => parseLinkTarget('group:01hxTEAM/member')).toThrow(/use record:01hxTEAM/);
  });

  it('points perm and grant at a group when handed that group’s record', () => {
    expect(() => parsePermissionTarget('record:01hxTEAM')).toThrow(
      /group:01hxTEAM\/<member\|admin>/,
    );
    expect(() => parseGrantTarget('record:01hxTEAM')).toThrow(/group:01hxTEAM\/<member\|admin>/);
  });

  it('refuses an access tier as something to link to', () => {
    expect(() => parseLinkTarget('anyone')).toThrow(/not something a record can point at/);
    expect(() => parseLinkTarget('authenticated')).toThrow(/not something a record can point at/);
  });

  it('always names what the command does accept', () => {
    expect(() => parsePermissionTarget('record:01hx')).toThrow(
      /perm accepts: anyone \| <did> \| group:<id>\/<member\|admin>/,
    );
    expect(() => parseGrantQuery('anyone')).toThrow(/grant accepts: authenticated/);
    expect(() => parseLinkTarget('anyone')).toThrow(/link accepts: <did> \| record:/);
  });
});
