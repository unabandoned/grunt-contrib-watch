'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var grunt = require('grunt');
var helper = require('./helper');

var cwd = path.resolve(helper.fixtures, 'events');

function cleanUp() {
  helper.cleanUp('events/lib/added.js');
}

function writeAll() {
  var write = 'var one = true;';
  grunt.file.write(path.join(cwd, 'lib', 'added.js'), write);
  setTimeout(function() {
    grunt.file.write(path.join(cwd, 'lib', 'one.js'), write);
  }, 500);
  setTimeout(function() {
    grunt.file.delete(path.join(cwd, 'lib', 'added.js'));
  }, 500);
}

async function run(task) {
  cleanUp();
  try {
    var r = await helper.runTask(task, {cwd: cwd}, writeAll);
    return helper.unixify(r.stdout);
  } finally {
    cleanUp();
  }
}

var ADDED = 'lib/added.js was indeed added';
var CHANGED = 'lib/one.js was indeed changed';
var DELETED = 'lib/added.js was indeed deleted';

test('all events', async function() {
  var out = await run('watch:all');
  assert.ok(out.indexOf(ADDED) !== -1, 'added');
  assert.ok(out.indexOf(CHANGED) !== -1, 'changed');
  assert.ok(out.indexOf(DELETED) !== -1, 'deleted');
});

test('event: added', async function() {
  var out = await run('watch:onlyAdded');
  assert.ok(out.indexOf(ADDED) !== -1);
  assert.ok(out.indexOf(CHANGED) === -1);
  assert.ok(out.indexOf(DELETED) === -1);
});

test('event: changed', async function() {
  var out = await run('watch:onlyChanged');
  assert.ok(out.indexOf(ADDED) === -1);
  assert.ok(out.indexOf(CHANGED) !== -1);
  assert.ok(out.indexOf(DELETED) === -1);
});

test('event: deleted', async function() {
  var out = await run('watch:onlyDeleted');
  assert.ok(out.indexOf(ADDED) === -1);
  assert.ok(out.indexOf(CHANGED) === -1);
  assert.ok(out.indexOf(DELETED) !== -1);
});

test('event: [added, deleted]', async function() {
  var out = await run('watch:onlyAddedAndDeleted');
  assert.ok(out.indexOf(ADDED) !== -1);
  assert.ok(out.indexOf(CHANGED) === -1);
  assert.ok(out.indexOf(DELETED) !== -1);
});

test('watch events carry the target name', async function() {
  var r = await helper.runTask('watch', {cwd: cwd}, function() {
    var write = 'var test = false;';
    setTimeout(function() {
      grunt.file.write(path.join(cwd, 'lib/one', 'test.js'), write);
    }, 300);
    setTimeout(function() {
      grunt.file.write(path.join(cwd, 'lib/two', 'test.js'), write);
    }, 300);
  });
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('lib/one/test.js was indeed changed\ntargetOne specific event was fired') !== -1);
  assert.ok(out.indexOf('lib/two/test.js was indeed changed\ntargetTwo specific event was fired') !== -1);
});

test('a watch listener can change the tasks to run', async function() {
  var out = await run('watch:changeTasks');
  assert.ok(out.indexOf('I havent changed') === -1);
  assert.ok(out.indexOf('Ive changed') !== -1);
});
