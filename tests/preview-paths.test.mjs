import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePublicFile } from '../scripts/preview-paths.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';

test('F02 allows public files and rejects casing, encoding, traversal and test/private paths', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'reader-paths-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const root = await realpath(folder);
  await writeFile(join(root, 'reader.html'), 'synthetic');
  await mkdir(join(root, 'tests/assets'), {recursive:true});
  await writeFile(join(root, 'tests/assets/security-entry.js'), 'export {};');
  assert.equal(await resolvePublicFile('/reader.html', root), join(root, 'reader.html'));
  assert.equal(await resolvePublicFile('/%72eader.html', root), join(root, 'reader.html'));
  assert.equal(await resolvePublicFile('/tests/assets/security-entry.js', root, true), join(root, 'tests/assets/security-entry.js'));
  for (const path of ['/node_modules/x', '/NODE_MODULES/x', '/NoDe_MoDuLeS/x', '/%6eode_modules/x', '/%256eode_modules/x', '/../reader.html', '/%2e%2e/reader.html', '/%252e%252e/reader.html', '/reader/../reader.html', '/reader%5c..%5creader.html', '/reader.html:stream', '/.env', '/docs/private.md', '/tests/reader.spec.js', '/scripts/preview.mjs', '/tests/assets/security-entry.js', '//reader.html', '/%00reader.html']) await assert.rejects(resolvePublicFile(path, root), undefined, path);
});
test('F02 rejects an allowed-looking asset resolved through a junction or symlink', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'reader-alias-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  await mkdir(join(folder, 'root/reader'), {recursive:true});
  await mkdir(join(folder, 'private'));
  await writeFile(join(folder, 'private/reader.js'), 'private synthetic sentinel');
  await symlink(join(folder, 'private'), join(folder, 'root/reader/assets'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolvePublicFile('/reader/assets/reader.js', await realpath(join(folder, 'root'))));
});

test('F02 default preview binds loopback and never serves the test harness', async t => {
  const server = spawn(process.execPath, ['scripts/preview.mjs','0'], { windowsHide:true });
  t.after(async () => { server.kill(); await once(server, 'exit'); });
  const output = await new Promise((resolve,reject) => { server.stdout.once('data', data => resolve(String(data))); server.once('error', reject); server.once('exit', code => reject(new Error(`Preview exited ${code}`))); });
  const address = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  assert.ok(address, output);
  const status = path => new Promise((resolve,reject) => {
    http.get({ hostname:'127.0.0.1',port:address[1],path }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  assert.equal(await status('/reader.html'),200);
  for (const path of ['/tests/assets/security-entry.js','/tests/reader.spec.js','/NODE_MODULES/markdown-it/package.json','/%2e%2e/package.json']) assert.equal(await status(path),404,path);
});
