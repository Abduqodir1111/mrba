import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryCache, cacheableRead } from '../apps/mobile/src/query-cache.ts';

test('navigation reuses reads and shares concurrent requests until expiry', async () => {
  let now = 0, calls = 0;
  const cache = new QueryCache(60, () => now);
  const fetcher = async () => ({ count: ++calls });
  assert.deepEqual(await Promise.all([cache.read('/stock', fetcher), cache.read('/stock', fetcher)]), [{count:1}, {count:1}]);
  assert.equal((await cache.read('/stock', fetcher)).count, 1);
  now = 60;
  assert.equal((await cache.read('/stock', fetcher)).count, 2);
});

test('writes/logout clear views and fence old pending reads', async () => {
  const cache = new QueryCache();
  let finish;
  const old = cache.read('/stock', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.set('view:inventory', { data: 'old account' });
  cache.clear();
  assert.equal(cache.peek('view:inventory'), undefined);
  assert.equal(await cache.read('/stock', async () => 'new data'), 'new data');
  finish('old data');
  await old;
  assert.equal(cache.peek('/stock'), 'new data');
});

test('failed requests are retried and do not enter the cache', async () => {
  const cache = new QueryCache();
  await assert.rejects(cache.read('stock', async () => { throw Error('offline'); }));
  assert.equal(await cache.read('stock', async () => 'online'), 'online');
});

test('period and supplier queries have independent cache keys', async () => {
  const cache = new QueryCache();
  assert.equal(await cache.read('/reports?from=1&supplier=A', async () => 'A'), 'A');
  assert.equal(await cache.read('/reports?from=2&supplier=B', async () => 'B'), 'B');
});

test('authentication, recovery, drafts, explicit reloads and writes bypass cache', () => {
  for (const route of ['/auth/me', '/system/context', '/commands/123', '/drafts/123', '/sessions']) assert.equal(cacheableRead(route), false);
  assert.equal(cacheableRead('/stock'), true);
  assert.equal(cacheableRead('/reports/sales?from=1'), true);
  for (const options of [{method:'POST'}, {method:'DELETE'}, {cache:'no-store'}, {headers:{Authorization:'x'}}]) assert.equal(cacheableRead('/stock', options), false);
});
