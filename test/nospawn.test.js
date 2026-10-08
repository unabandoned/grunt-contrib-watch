'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var grunt = require('grunt');
var helper = require('./helper');

var cwd = path.resolve(helper.fixtures, 'nospawn');

test('nospawn keeps state (a server) alive across runs', async function() {
  var r = await helper.runTask(['server', 'watch'], {cwd: cwd}, function() {
    grunt.file.write(path.join(cwd, 'lib', 'nospawn.js'), 'var nospawn = true;');
  });
  assert.equal(helper.count(r.stdout, 'Running "watch" task'), 2, 'watch should have started twice');
  assert.ok(r.stdout.indexOf('Server is listening...') !== -1);
  assert.ok(r.stdout.indexOf('Server is talking!') !== -1);
});

test('nospawn with interrupt', async function() {
  var r = await helper.runTask('watch', {cwd: cwd, killAfter: 4000}, function() {
    var write = 'var interrupt = true;';
    grunt.file.write(path.join(cwd, 'lib', 'interrupt.js'), write);
    setTimeout(function() {
      grunt.file.write(path.join(cwd, 'lib', 'interrupt.js'), write);
    }, 1000);
  });
  assert.equal(helper.count(r.stdout, 'Running "long" task'), 4, 'long task should have run 4 times');
  assert.ok(r.stdout.indexOf('have been interrupted') !== -1);
});
