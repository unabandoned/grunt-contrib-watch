'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var grunt = require('grunt');
var helper = require('./helper');

var cwd = path.resolve(helper.fixtures, 'fail');

function edit() {
  grunt.file.write(path.join(cwd, 'lib/one.js'), 'var one = true;');
}

test('grunt.warn does not stop the watch (spawn: false)', async function() {
  var r = await helper.runTask('watch:warn', {cwd: cwd}, [edit, edit]);
  assert.equal(helper.count(r.stdout, 'This task should warn'), 2);
});

test('grunt.fatal does not stop the watch (spawn: false)', async function() {
  var r = await helper.runTask('watch:fatal', {cwd: cwd}, [edit, edit]);
  assert.equal(helper.count(r.stdout, 'This task should be fatal'), 2);
});
