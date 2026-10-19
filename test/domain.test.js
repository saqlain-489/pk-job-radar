import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain, companyDomain, mergeByDomain, isContacted, normName } from '../src/lib/domain.js';

test('registrable domain strips www and keeps Pakistani second-level TLDs', () => {
  assert.equal(registrableDomain('www.arbisoft.com'), 'arbisoft.com');
  assert.equal(registrableDomain('careers.10pearls.com'), '10pearls.com');
  assert.equal(registrableDomain('www.genxe.com.pk'), 'genxe.com.pk');
  assert.equal(registrableDomain('jobs.nayatel.net.pk'), 'nayatel.net.pk');
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
});

test('shared builder hosts keep the full subdomain as identity', () => {
  assert.equal(registrableDomain('acmesoft.wixsite.com'), 'acmesoft.wixsite.com');
  assert.equal(registrableDomain('acme-soft.business.site'), 'acme-soft.business.site');
  assert.equal(registrableDomain('wixsite.com'), '');
});

test('social and directory links are not a company domain', () => {
  assert.deepEqual(companyDomain('https://www.facebook.com/acmesoft'), { domain: '', social: 'https://www.facebook.com/acmesoft' });
  assert.equal(companyDomain('https://wa.me/923001234567').domain, '');
  assert.equal(companyDomain('https://linktr.ee/acme').domain, '');
  assert.equal(companyDomain('http://www.techverx.com/').domain, 'techverx.com');
  assert.equal(companyDomain('techverx.com/about').domain, 'techverx.com');
  assert.equal(companyDomain('').domain, '');
});

test('mergeByDomain merges branches that share a website, keeps site-less places apart', () => {
  const places = [
    { cid: '0x1:0xa', name: '10Pearls Lahore', website: 'https://10pearls.com/' },
    { cid: '0x2:0xb', name: '10Pearls Gulberg', website: 'http://www.10pearls.com/contact' },
    { cid: '0x3:0xc', name: 'Webtohelp', website: '' },
    { cid: '0x4:0xd', name: 'Solo Dev', website: 'https://facebook.com/solodev' },
    { cid: '0x5:0xe', name: 'Techverx', website: 'http://www.techverx.com/' },
  ];
  const groups = mergeByDomain(places);
  assert.equal(groups.length, 4);
  const pearls = groups.find((g) => g.domain === '10pearls.com');
  assert.equal(pearls.places.length, 2);
  assert.equal(groups.find((g) => g.key === 'cid:0x4:0xd').social, 'https://facebook.com/solodev');
  assert.ok(groups.some((g) => g.key === 'cid:0x3:0xc'));
});

test('already-contacted matching survives spacing, suffixes and domain-only matches', () => {
  const list = ['Byteforge', 'Star Labs', 'Nimbus Aviation', 'Quillsoft'];
  assert.ok(isContacted('Byte Forge (Pvt) Ltd', '', list));
  assert.ok(isContacted('Star Labs Lahore', 'starlabs.pk', list));
  assert.ok(isContacted('Some Name', 'quillsoft.com', list));
  assert.ok(!isContacted('Ninja Technologies', 'ninjatech.com', list));
  assert.equal(normName('Arbisoft (SMC-Pvt) Ltd.'), 'arbisoft');
});
